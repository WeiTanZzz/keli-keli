use crate::{config, storage};
use tokio::time::Duration;

/// Snapshot of cumulative counts used to compute the per-interval delta.
#[derive(Default, Clone, Copy)]
pub(crate) struct SyncSnapshot {
    pub(crate) keystrokes: u64,
    pub(crate) left_clicks: u64,
    pub(crate) right_clicks: u64,
}

pub(crate) async fn do_sync(
    client: &reqwest::Client,
    storage: &storage::Storage,
    cfg: &config::SyncConfig,
    prev: &SyncSnapshot,
) -> SyncSnapshot {
    // Reject non-http(s) URLs to prevent SSRF via file://, ftp://, etc.
    let scheme = cfg.api_url.split("://").next().unwrap_or("");
    if scheme != "http" && scheme != "https" {
        return *prev;
    }
    let (ks, left, right) = storage.all_time_counts();
    let now = SyncSnapshot {
        keystrokes: ks,
        left_clicks: left,
        right_clicks: right,
    };
    let synced_at = chrono::Local::now().to_rfc3339();
    client
        .post(&cfg.api_url)
        .bearer_auth(&cfg.api_key)
        .json(&serde_json::json!({
            "synced_at": synced_at,
            "totals": {
                "keystrokes": ks,
                "left_clicks": left,
                "right_clicks": right,
            },
            "delta": {
                "keystrokes": ks.saturating_sub(prev.keystrokes),
                "left_clicks": left.saturating_sub(prev.left_clicks),
                "right_clicks": right.saturating_sub(prev.right_clicks),
                "period_secs": cfg.interval_secs,
            },
        }))
        .send()
        .await
        .ok();
    now
}

pub(crate) async fn sync_loop(storage: storage::Storage, cfg: config::SyncConfig) {
    let client = reqwest::Client::new();
    let mut interval = tokio::time::interval(Duration::from_secs(cfg.interval_secs));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await; // skip the first immediate tick
                           // Snapshot before the first real tick so the first delta reflects activity
                           // since the app started, not since the beginning of time.
    let mut prev = {
        let (ks, left, right) = storage.all_time_counts();
        SyncSnapshot {
            keystrokes: ks,
            left_clicks: left,
            right_clicks: right,
        }
    };
    loop {
        interval.tick().await;
        prev = do_sync(&client, &storage, &cfg, &prev).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_storage() -> (TempDir, storage::Storage) {
        let dir = TempDir::new().unwrap();
        let s = storage::Storage::load_from(dir.path().join("data.json"));
        (dir, s)
    }

    fn test_sync_cfg(url: &str) -> config::SyncConfig {
        config::SyncConfig {
            enabled: true,
            api_url: url.to_string(),
            api_key: "test-key".to_string(),
            interval_secs: 60,
        }
    }

    #[tokio::test]
    async fn sync_sends_totals_and_delta() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/")
            .match_header("authorization", "Bearer test-key")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "totals": { "keystrokes": 3u64, "left_clicks": 2u64, "right_clicks": 1u64 },
                "delta":  { "keystrokes": 3u64, "left_clicks": 2u64, "right_clicks": 1u64,
                             "period_secs": 60u64 },
            })))
            .with_status(200)
            .expect(1)
            .create_async()
            .await;

        let (_dir, storage) = temp_storage();
        for _ in 0..3 {
            storage.increment_today();
        }
        storage.increment_today_app_click("Safari", 0);
        storage.increment_today_app_click("Safari", 0);
        storage.increment_today_app_click("Safari", 1);

        let client = reqwest::Client::new();
        let prev = SyncSnapshot::default();
        do_sync(&client, &storage, &test_sync_cfg(&server.url()), &prev).await;

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_delta_reflects_activity_since_last_sync() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "totals": { "keystrokes": 10u64, "left_clicks": 0u64, "right_clicks": 0u64 },
                "delta":  { "keystrokes": 3u64,  "left_clicks": 0u64, "right_clicks": 0u64 },
            })))
            .with_status(200)
            .expect(1)
            .create_async()
            .await;

        let (_dir, storage) = temp_storage();
        for _ in 0..10 {
            storage.increment_today();
        }

        let client = reqwest::Client::new();
        let prev = SyncSnapshot {
            keystrokes: 7,
            left_clicks: 0,
            right_clicks: 0,
        };
        do_sync(&client, &storage, &test_sync_cfg(&server.url()), &prev).await;

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_continues_after_server_error() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/")
            .with_status(500)
            .expect(2)
            .create_async()
            .await;

        let (_dir, storage) = temp_storage();
        let client = reqwest::Client::new();
        let cfg = test_sync_cfg(&server.url());
        let prev = SyncSnapshot::default();

        do_sync(&client, &storage, &cfg, &prev).await;
        do_sync(&client, &storage, &cfg, &prev).await;

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_rejects_non_http_url() {
        let (_dir, storage) = temp_storage();
        let client = reqwest::Client::new();

        for bad_url in &["file:///etc/passwd", "ftp://example.com", "javascript://x"] {
            let cfg = config::SyncConfig {
                enabled: true,
                api_url: bad_url.to_string(),
                api_key: "k".to_string(),
                interval_secs: 60,
            };
            do_sync(&client, &storage, &cfg, &SyncSnapshot::default()).await;
        }
    }
}
