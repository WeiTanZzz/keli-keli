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

#[derive(serde::Serialize, Clone)]
struct KeystrokePayload {
    count: u64,
}

#[derive(serde::Serialize)]
struct DayStat {
    date: String,
    count: u64,
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
        }
    }
}

pub fn run() {
    let cfg = config::load();
    let storage = storage::Storage::load();
    let idle_ms = cfg.websocket.typing_idle_ms;
    let flush_secs = cfg.flush_interval_secs;

    let ws_url = if cfg.websocket.enabled && !cfg.websocket.ws_url.is_empty() {
        Some(cfg.websocket.ws_url.clone())
    } else {
        None
    };
    let sync_cfg = if cfg.sync.enabled && !cfg.sync.api_url.is_empty() {
        Some(cfg.sync.clone())
    } else {
        None
    };

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
            get_config, save_config, get_stats,
            get_autostart, set_autostart
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            setup_tray(app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_updater::UpdaterExt;
                if let Ok(updater) = handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                            handle.restart();
                        }
                    }
                }
            });
            if let Some(win) = app.get_webview_window("main") {
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
            }
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

    TrayIconBuilder::with_id("main-tray")
        .icon(build_tray_icon())
        .tooltip("KeliKeli")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        win.hide().ok();
                    } else {
                        win.show().ok();
                        win.set_focus().ok();
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
        .inner_size(380.0, 540.0)
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

async fn sync_loop(storage: storage::Storage, cfg: config::SyncConfig) {
    let client = reqwest::Client::new();
    let mut interval = tokio::time::interval(Duration::from_secs(cfg.interval_secs));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await; // skip the first immediate tick
    loop {
        interval.tick().await;
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
