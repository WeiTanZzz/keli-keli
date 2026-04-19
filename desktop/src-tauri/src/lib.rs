mod commands;
mod config;
mod hook;
#[cfg(target_os = "macos")]
mod macos;
mod storage;
mod sync;
mod tray;
mod update;
mod ws;

use hook::KeyEvent;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio::time::{Duration, Instant};
use tray::CountItem;

/// Set to true by the tray "Quit" button so the ExitRequested handler
/// knows to skip the confirmation dialog (user already chose to quit).
pub(crate) static SKIP_QUIT_DIALOG: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize, Clone)]
struct KeystrokePayload {
    count: u64,
    app: String,
}

#[derive(serde::Serialize, Clone)]
struct ClickPayload {
    app: String,
    /// 0 = left, 1 = right, 2 = other/middle
    button: u8,
}

async fn key_loop(
    app: AppHandle,
    storage: storage::Storage,
    mut key_rx: mpsc::UnboundedReceiver<KeyEvent>,
    ws_tx: Option<mpsc::UnboundedSender<ws::WsEvent>>,
    cfg_state: Arc<Mutex<config::Config>>,
) {
    let mut last_key = Instant::now();
    let mut last_flush = Instant::now();
    let mut is_typing = false;

    loop {
        // Re-read config each iteration so flush interval and idle timeout
        // reflect any changes the user saved without requiring a restart.
        let (idle_ms, flush_secs) = {
            let c = cfg_state.lock().unwrap_or_else(|e| e.into_inner());
            (c.websocket.typing_idle_ms, c.flush_interval_secs)
        };
        let idle_duration = Duration::from_millis(idle_ms);
        let flush_duration = Duration::from_secs(flush_secs);

        tokio::select! {
            event = key_rx.recv() => {
                match event {
                    Some(KeyEvent::MouseClick {
                        app: ref app_name,
                        button,
                    }) => {
                        storage.increment_today_app_click(app_name, button);
                        app.emit(
                            "click",
                            ClickPayload {
                                app: app_name.clone(),
                                button,
                            },
                        )
                        .ok();
                        if let Some(tx) = &ws_tx {
                            tx.send(ws::WsEvent::Click {
                                app: app_name.clone(),
                                button,
                            })
                            .ok();
                        }
                        last_key = Instant::now();
                        if last_flush.elapsed() >= flush_duration {
                            storage.save();
                            last_flush = Instant::now();
                        }
                    }
                    Some(KeyEvent::KeyPress { app: ref app_name }) => {
                        let count = storage.increment_today();
                        storage.increment_today_app(app_name);
                        app.emit(
                            "keystroke",
                            KeystrokePayload { count, app: app_name.clone() },
                        )
                        .ok();
                        if let Ok(item) = app.state::<CountItem>().0.lock() {
                            item.set_text(format!("Today: {count} keystrokes")).ok();
                        }
                        if !is_typing {
                            is_typing = true;
                            if let Some(tx) = &ws_tx {
                                tx.send(ws::WsEvent::TypingStart).ok();
                            }
                        }
                        if let Some(tx) = &ws_tx {
                            tx.send(ws::WsEvent::Keystroke { app: app_name.clone() }).ok();
                        }
                        last_key = Instant::now();
                        if last_flush.elapsed() >= flush_duration {
                            storage.save();
                            last_flush = Instant::now();
                        }
                    }
                    #[cfg(target_os = "macos")]
                    Some(KeyEvent::CmdQ) => {
                        // Cmd+Q was swallowed by the event tap; ask the user.
                        let app_h = app.clone();
                        let storage_h = storage.clone();
                        let _ = app.run_on_main_thread(move || {
                            if macos::macos_confirm_quit() {
                                storage_h.save();
                                SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
                                app_h.exit(0);
                            }
                        });
                    }
                    #[cfg(not(target_os = "macos"))]
                    Some(KeyEvent::CmdQ) => {}
                    None => break,
                }
            }
            _ = tokio::time::sleep_until(last_key + idle_duration), if is_typing => {
                is_typing = false;
                if let Some(tx) = &ws_tx {
                    tx.send(ws::WsEvent::TypingStop).ok();
                }
            }
        }
    }
}

pub fn run() {
    let cfg = config::load();
    let storage = storage::Storage::load();
    let auto_update = cfg.auto_update;

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

    let cfg_arc = Arc::new(Mutex::new(cfg));
    let cfg_for_key_loop = Arc::clone(&cfg_arc);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(cfg_arc)
        .manage(storage.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::save_config_and_restart,
            commands::get_all_time_counts,
            commands::get_stats,
            commands::get_app_stats,
            commands::get_app_click_stats,
            commands::get_autostart,
            commands::set_autostart,
            commands::check_update,
            commands::install_update,
            commands::get_app_icon,
            commands::get_app_display_name,
        ])
        .setup(move |app| {
            // Set activation policy FIRST, before any window is created.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
            macos::make_webview_transparent(&win);
            #[cfg(target_os = "macos")]
            macos::prevent_become_key_window(&win);

            if let Ok(Some(monitor)) = win.primary_monitor() {
                let screen = monitor.size();
                let win_size = win.outer_size().unwrap_or_default();
                win.set_position(tauri::PhysicalPosition {
                    x: (screen.width as i32) - (win_size.width as i32) - 24,
                    y: (screen.height as f32 * 0.8) as i32,
                })
                .ok();
            }

            tray::setup_tray(app.handle())?;
            tauri::async_runtime::spawn(update::startup_update_check(
                app.handle().clone(),
                auto_update,
            ));
            let ws_tx = ws_url.map(|url| {
                let (tx, rx) = mpsc::unbounded_channel::<ws::WsEvent>();
                tauri::async_runtime::spawn(ws::ws_loop(rx, url));
                tx
            });
            if let Some(sync) = sync_cfg {
                tauri::async_runtime::spawn(sync::sync_loop(storage.clone(), sync));
            }
            tauri::async_runtime::spawn(key_loop(
                app.handle().clone(),
                storage,
                key_rx,
                ws_tx,
                cfg_for_key_loop,
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
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if SKIP_QUIT_DIALOG.load(Ordering::Relaxed) {
                    return;
                }
                #[cfg(target_os = "macos")]
                {
                    if !macos::macos_confirm_quit() {
                        api.prevent_exit();
                        return;
                    }
                }
                if let Some(storage) = app_handle.try_state::<storage::Storage>() {
                    storage.save();
                }
            }
        });
}
