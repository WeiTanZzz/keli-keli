use crate::{config, storage};
use std::collections::HashMap;
use tokio::time::Duration;

/// Snapshot of cumulative counts used to compute the per-interval delta.
#[derive(Default, Clone)]
pub(crate) struct SyncSnapshot {
    pub(crate) keystrokes: u64,
    pub(crate) left_clicks: u64,
    pub(crate) right_clicks: u64,
    pub(crate) app_keystrokes: HashMap<String, u64>,
    pub(crate) app_left_clicks: HashMap<String, u64>,
    pub(crate) app_right_clicks: HashMap<String, u64>,
}

impl SyncSnapshot {
    fn from_storage(storage: &storage::Storage) -> Self {
        let (keystrokes, left_clicks, right_clicks) = storage.all_time_counts();
        let mut app_keystrokes = HashMap::new();
        let mut app_left_clicks = HashMap::new();
        let mut app_right_clicks = HashMap::new();
        for (_, app, count) in storage.get_app_stats(1) {
            app_keystrokes.insert(app, count);
        }
        for (_, app, lc, rc) in storage.get_app_click_stats(1) {
            app_left_clicks.insert(app.clone(), lc);
            app_right_clicks.insert(app, rc);
        }
        Self {
            keystrokes,
            left_clicks,
            right_clicks,
            app_keystrokes,
            app_left_clicks,
            app_right_clicks,
        }
    }
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
        return prev.clone();
    }

    let now = SyncSnapshot::from_storage(storage);

    // Per-app delta for this interval: only include apps with activity
    let all_apps: std::collections::HashSet<&String> = now
        .app_keystrokes
        .keys()
        .chain(now.app_left_clicks.keys())
        .chain(now.app_right_clicks.keys())
        .collect();

    let mut apps_array: Vec<serde_json::Value> = all_apps
        .into_iter()
        .filter_map(|app| {
            let ks = now
                .app_keystrokes
                .get(app)
                .copied()
                .unwrap_or(0)
                .saturating_sub(prev.app_keystrokes.get(app).copied().unwrap_or(0));
            let lc = now
                .app_left_clicks
                .get(app)
                .copied()
                .unwrap_or(0)
                .saturating_sub(prev.app_left_clicks.get(app).copied().unwrap_or(0));
            let rc = now
                .app_right_clicks
                .get(app)
                .copied()
                .unwrap_or(0)
                .saturating_sub(prev.app_right_clicks.get(app).copied().unwrap_or(0));
            if ks == 0 && lc == 0 && rc == 0 {
                return None;
            }
            Some(serde_json::json!({
                "app": app,
                "keystrokes": ks,
                "left_clicks": lc,
                "right_clicks": rc,
            }))
        })
        .collect();
    apps_array.sort_by_key(|v| {
        let ks = v["keystrokes"].as_u64().unwrap_or(0);
        let lc = v["left_clicks"].as_u64().unwrap_or(0);
        let rc = v["right_clicks"].as_u64().unwrap_or(0);
        std::cmp::Reverse(ks + lc + rc)
    });

    let synced_at = chrono::Local::now().to_rfc3339();
    client
        .post(&cfg.api_url)
        .bearer_auth(&cfg.api_key)
        .json(&serde_json::json!({
            "synced_at": synced_at,
            "totals": {
                "keystrokes": now.keystrokes,
                "left_clicks": now.left_clicks,
                "right_clicks": now.right_clicks,
            },
            "delta": {
                "keystrokes": now.keystrokes.saturating_sub(prev.keystrokes),
                "left_clicks": now.left_clicks.saturating_sub(prev.left_clicks),
                "right_clicks": now.right_clicks.saturating_sub(prev.right_clicks),
                "period_secs": cfg.interval_secs,
                "apps": apps_array,
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
    interval.tick().await;
    let mut prev = SyncSnapshot::from_storage(&storage);
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
        do_sync(
            &client,
            &storage,
            &test_sync_cfg(&server.url()),
            &SyncSnapshot::default(),
        )
        .await;
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
            ..Default::default()
        };
        do_sync(&client, &storage, &test_sync_cfg(&server.url()), &prev).await;
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn delta_apps_only_includes_active_apps_in_interval() {
        let mut server = mockito::Server::new_async().await;

        let mock = server
            .mock("POST", "/")
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "delta": { "apps": [{ "app": "Xcode", "keystrokes": 3u64 }] },
            })))
            .with_status(200)
            .expect(1)
            .create_async()
            .await;

        let (_dir, storage) = temp_storage();
        for _ in 0..5 {
            storage.increment_today_app("Xcode");
        }
        let prev = SyncSnapshot::from_storage(&storage);
        for _ in 0..3 {
            storage.increment_today_app("Xcode");
        }

        let client = reqwest::Client::new();
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
