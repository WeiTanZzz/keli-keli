mod config;
mod hook;
mod storage;

use futures_util::SinkExt;
use hook::KeyEvent;
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image as TrayImage,
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};
use tokio::sync::mpsc;
use tokio::time::{Duration, Instant};

struct CountItem(Mutex<MenuItem<Wry>>);
struct ToggleItem(Mutex<MenuItem<Wry>>);

#[derive(serde::Serialize, Clone)]
struct KeystrokePayload {
    count: u64,
}

#[derive(serde::Serialize)]
struct DayStat {
    date: String,
    count: u64,
}

#[derive(serde::Serialize)]
struct UpdateStatus {
    current: String,
    latest: Option<String>,
    available: bool,
}

enum WsEvent {
    Keystroke(u64),
    TypingStart,
    TypingStop,
}

#[tauri::command]
fn get_config(state: tauri::State<Arc<Mutex<config::Config>>>) -> config::Config {
    state.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(new_cfg: config::Config, state: tauri::State<Arc<Mutex<config::Config>>>) {
    config::save(&new_cfg);
    *state.lock().unwrap() = new_cfg;
}

#[tauri::command]
fn get_stats(days: usize, storage: tauri::State<storage::Storage>) -> Vec<DayStat> {
    storage
        .get_stats(days)
        .into_iter()
        .map(|(date, count)| DayStat { date, count })
        .collect()
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateStatus, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    let updater = app
        .updater()
        .map_err(|_| "Could not reach update server".to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateStatus {
            current,
            latest: Some(update.version.clone()),
            available: true,
        }),
        Ok(None) => Ok(UpdateStatus {
            current,
            latest: None,
            available: false,
        }),
        Err(_) => Err("Could not reach update server".to_string()),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|_| "Update failed, please try again later".to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|_| "Could not reach update server".to_string())?
        .ok_or("Already on the latest version".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| "Download failed, please try again later".to_string())?;
    app.restart();
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable().ok();
    } else {
        app.autolaunch().disable().ok();
    }
}

#[cfg(target_os = "macos")]
fn make_webview_transparent(win: &tauri::WebviewWindow) {
    use objc::runtime::{Class, Object, NO};
    use objc::{msg_send, sel, sel_impl};
    if let Ok(ptr) = win.ns_window() {
        unsafe {
            let ns_window = ptr as *mut Object;
            let clear: *mut Object = msg_send![Class::get("NSColor").unwrap(), clearColor];
            let _: () = msg_send![ns_window, setOpaque: NO];
            let _: () = msg_send![ns_window, setBackgroundColor: clear];
            let content: *mut Object = msg_send![ns_window, contentView];
            let _: () = msg_send![content, setOpaque: NO];
            let _: () = msg_send![content, setBackgroundColor: clear];
            let subviews: *mut Object = msg_send![content, subviews];
            let count: usize = msg_send![subviews, count];
            for i in 0..count {
                let view: *mut Object = msg_send![subviews, objectAtIndex: i];
                let _: () = msg_send![view, setOpaque: NO];
                let _: () = msg_send![view, setBackgroundColor: clear];
            }
            // Level 10000: high enough to appear above full-screen apps on all Spaces
            let _: () = msg_send![ns_window, setLevel: 10000i64];
            // Read existing behavior first, then OR in our flags to preserve Tauri's defaults
            // CanJoinAllSpaces (1) | Stationary (16) | FullScreenAuxiliary (256)
            let existing: usize = msg_send![ns_window, collectionBehavior];
            let _: () = msg_send![ns_window, setCollectionBehavior: existing | 1 | 16 | 256];
        }
    }
}

pub fn run() {
    let cfg = config::load();
    let storage = storage::Storage::load();
    let idle_ms = cfg.websocket.typing_idle_ms;
    let flush_secs = cfg.flush_interval_secs;

    let ws_url = cfg
        .websocket
        .enabled
        .then_some(cfg.websocket.ws_url.clone())
        .filter(|u| !u.is_empty());
    let sync_cfg = cfg
        .sync
        .enabled
        .then_some(cfg.sync.clone())
        .filter(|s| !s.api_url.is_empty());

    let (key_tx, key_rx) = mpsc::unbounded_channel::<KeyEvent>();
    hook::start(key_tx);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Arc::new(Mutex::new(cfg)))
        .manage(storage.clone())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_stats,
            get_autostart,
            set_autostart,
            check_update,
            install_update
        ])
        .setup(move |app| {
            // Set activation policy FIRST, before any window is created.
            // This is equivalent to LSUIElement=true in Info.plist and is required
            // for NSWindowCollectionBehaviorCanJoinAllSpaces to work in full-screen spaces.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Now create the window programmatically so NSWindow inherits the correct policy.
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("KeliKeli")
            .inner_size(72.0, 80.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .accept_first_mouse(true)
            .visible(true)
            .build()?;

            #[cfg(target_os = "macos")]
            make_webview_transparent(&win);

            if let Ok(Some(monitor)) = win.primary_monitor() {
                let screen = monitor.size();
                let win_size = win.outer_size().unwrap_or_default();
                win.set_position(tauri::PhysicalPosition {
                    x: (screen.width as i32) - (win_size.width as i32) - 24,
                    y: (screen.height as f32 * 0.8) as i32,
                })
                .ok();
            }

            setup_tray(app.handle())?;
            let ws_tx = ws_url.map(|url| {
                let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
                tauri::async_runtime::spawn(ws_loop(rx, url));
                tx
            });
            if let Some(sync) = sync_cfg {
                tauri::async_runtime::spawn(sync_loop(storage.clone(), sync));
            }
            tauri::async_runtime::spawn(key_loop(
                app.handle().clone(),
                storage,
                key_rx,
                ws_tx,
                idle_ms,
                flush_secs,
            ));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().ok();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let count = MenuItemBuilder::with_id("count", "Today: 0 keystrokes")
        .enabled(false)
        .build(app)?;
    let sep0 = PredefinedMenuItem::separator(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Hide Indicator").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit KeliKeli").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&count, &sep0, &toggle, &settings, &sep, &quit])
        .build()?;

    app.manage(CountItem(Mutex::new(count)));
    app.manage(ToggleItem(Mutex::new(toggle)));

    TrayIconBuilder::with_id("main-tray")
        .icon(build_tray_icon())
        .tooltip("KeliKeli")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(win) = app.get_webview_window("main") {
                    let visible = win.is_visible().unwrap_or(false);
                    if visible {
                        win.hide().ok();
                    } else {
                        win.show().ok();
                        win.set_focus().ok();
                    }
                    if let Ok(item) = app.state::<ToggleItem>().0.lock() {
                        item.set_text(if visible {
                            "Show Indicator"
                        } else {
                            "Hide Indicator"
                        })
                        .ok();
                    }
                }
            }
            "settings" => open_settings_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn open_settings_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().ok();
        win.set_focus().ok();
    } else {
        tauri::WebviewWindowBuilder::new(
            app,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("KeliKeli Settings")
        .inner_size(380.0, 580.0)
        .resizable(false)
        .center()
        .build()
        .ok();
    }
}

fn build_tray_icon() -> TrayImage<'static> {
    let bytes = include_bytes!("../icons/32x32.png");
    TrayImage::from_bytes(bytes).expect("failed to load tray icon")
}

async fn key_loop(
    app: AppHandle,
    storage: storage::Storage,
    mut key_rx: mpsc::UnboundedReceiver<KeyEvent>,
    ws_tx: Option<mpsc::UnboundedSender<WsEvent>>,
    idle_ms: u64,
    flush_secs: u64,
) {
    let mut last_key = Instant::now();
    let mut last_flush = Instant::now();
    let mut is_typing = false;
    let idle_duration = Duration::from_millis(idle_ms);
    let flush_duration = Duration::from_secs(flush_secs);

    loop {
        tokio::select! {
            event = key_rx.recv() => {
                match event {
                    Some(KeyEvent::KeyPress) => {
                        let count = storage.increment_today();
                        app.emit("keystroke", KeystrokePayload { count }).ok();
                        if let Ok(item) = app.state::<CountItem>().0.lock() {
                            item.set_text(format!("Today: {count} keystrokes")).ok();
                        }
                        if !is_typing {
                            is_typing = true;
                            if let Some(tx) = &ws_tx {
                                tx.send(WsEvent::TypingStart).ok();
                            }
                        }
                        if let Some(tx) = &ws_tx {
                            tx.send(WsEvent::Keystroke(count)).ok();
                        }
                        last_key = Instant::now();
                        if last_flush.elapsed() >= flush_duration {
                            storage.save();
                            last_flush = Instant::now();
                        }
                    }
                    None => break,
                }
            }
            _ = tokio::time::sleep_until(last_key + idle_duration), if is_typing => {
                is_typing = false;
                if let Some(tx) = &ws_tx {
                    tx.send(WsEvent::TypingStop).ok();
                }
            }
        }
    }
}

async fn do_sync(client: &reqwest::Client, storage: &storage::Storage, cfg: &config::SyncConfig) {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let count = storage.today_count();
    client
        .post(&cfg.api_url)
        .bearer_auth(&cfg.api_key)
        .json(&serde_json::json!({ "date": today, "count": count }))
        .send()
        .await
        .ok();
}

async fn sync_loop(storage: storage::Storage, cfg: config::SyncConfig) {
    let client = reqwest::Client::new();
    let mut interval = tokio::time::interval(Duration::from_secs(cfg.interval_secs));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await; // skip the first immediate tick
    loop {
        interval.tick().await;
        do_sync(&client, &storage, &cfg).await;
    }
}

async fn ws_loop(mut rx: mpsc::UnboundedReceiver<WsEvent>, url: String) {
    use tokio_tungstenite::tungstenite::Message;
    loop {
        let Ok((mut ws, _)) = tokio_tungstenite::connect_async(&url).await else {
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        };
        loop {
            match rx.recv().await {
                Some(event) => {
                    let payload = match event {
                        WsEvent::Keystroke(count) => {
                            serde_json::json!({ "type": "keystroke", "count": count })
                        }
                        WsEvent::TypingStart => serde_json::json!({ "type": "typing_start" }),
                        WsEvent::TypingStop => serde_json::json!({ "type": "typing_stop" }),
                    };
                    if ws.send(Message::Text(payload.to_string())).await.is_err() {
                        break;
                    }
                }
                None => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use tempfile::TempDir;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    // ── helpers ──────────────────────────────────────────────────────────────

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

    fn parse_ws_msg(msg: &tokio_tungstenite::tungstenite::Message) -> serde_json::Value {
        serde_json::from_str(msg.to_text().unwrap()).unwrap()
    }

    // ── do_sync tests ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn sync_sends_correct_json_payload() {
        let mut server = mockito::Server::new_async().await;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        let mock = server
            .mock("POST", "/")
            .match_header("authorization", "Bearer test-key")
            .match_body(mockito::Matcher::Json(
                serde_json::json!({ "date": today, "count": 3u64 }),
            ))
            .with_status(200)
            .expect(1)
            .create_async()
            .await;

        let (_dir, storage) = temp_storage();
        for _ in 0..3 {
            storage.increment_today();
        }

        let client = reqwest::Client::new();
        do_sync(&client, &storage, &test_sync_cfg(&server.url())).await;

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

        // Two syncs despite 500 responses — should not panic
        do_sync(&client, &storage, &cfg).await;
        do_sync(&client, &storage, &cfg).await;

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_sends_zero_count_when_no_keystrokes() {
        let mut server = mockito::Server::new_async().await;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        let mock = server
            .mock("POST", "/")
            .match_body(mockito::Matcher::Json(
                serde_json::json!({ "date": today, "count": 0u64 }),
            ))
            .with_status(200)
            .expect(1)
            .create_async()
            .await;

        let (_dir, storage) = temp_storage();
        let client = reqwest::Client::new();
        do_sync(&client, &storage, &test_sync_cfg(&server.url())).await;

        mock.assert_async().await;
    }

    // ── ws_loop tests ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn ws_connects_and_delivers_keystroke_event() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(
            Duration::from_secs(2),
            listener.accept(),
        )
        .await
        .unwrap()
        .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::Keystroke(42)).unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        let val = parse_ws_msg(&msg);
        assert_eq!(val["type"], "keystroke");
        assert_eq!(val["count"], 42);
    }

    #[tokio::test]
    async fn ws_delivers_typing_start_and_stop_events() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::TypingStart).unwrap();
        tx.send(WsEvent::TypingStop).unwrap();

        let start_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await.unwrap().unwrap().unwrap();
        assert_eq!(parse_ws_msg(&start_msg)["type"], "typing_start");

        let stop_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await.unwrap().unwrap().unwrap();
        assert_eq!(parse_ws_msg(&stop_msg)["type"], "typing_stop");
    }

    #[tokio::test]
    async fn ws_reconnects_after_server_closes_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        // First connection
        let (s1, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await.unwrap().unwrap();
        let mut ws1 = accept_async(s1).await.unwrap();

        // Send and receive event 1
        tx.send(WsEvent::Keystroke(1)).unwrap();
        let msg1 = tokio::time::timeout(Duration::from_secs(2), ws1.next())
            .await.unwrap().unwrap().unwrap();
        assert_eq!(parse_ws_msg(&msg1)["count"], 1);

        // Drop server-side to force a broken pipe on the next client send
        drop(ws1);
        tokio::task::yield_now().await;

        // Send event 2 — ws_loop will attempt to send on the dead connection,
        // get an error, break the inner loop, then reconnect immediately.
        tx.send(WsEvent::Keystroke(2)).unwrap();

        // Accept reconnection (ws_loop reconnects without delay when connect succeeds)
        let (s2, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await.unwrap().unwrap();
        let mut ws2 = accept_async(s2).await.unwrap();

        // Send event 3 to confirm the new connection works
        tx.send(WsEvent::Keystroke(3)).unwrap();

        // ── BUG: event 2 was consumed from rx but never delivered (lost on
        // the broken send). After the fix, event 2 must arrive first. ──
        let first = tokio::time::timeout(Duration::from_secs(2), ws2.next())
            .await.unwrap().unwrap().unwrap();
        assert_eq!(
            parse_ws_msg(&first)["count"], 2,
            "event 2 should be retried after reconnect, not silently dropped"
        );

        let second = tokio::time::timeout(Duration::from_secs(2), ws2.next())
            .await.unwrap().unwrap().unwrap();
        assert_eq!(parse_ws_msg(&second)["count"], 3);
    }
}
