mod config;
mod hook;
mod storage;

use futures_util::{SinkExt, StreamExt};
use hook::KeyEvent;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
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

/// Set to true by the tray "Quit" button so the ExitRequested handler
/// knows to skip the confirmation dialog (user already chose to quit).
static SKIP_QUIT_DIALOG: AtomicBool = AtomicBool::new(false);

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

#[derive(serde::Serialize)]
struct DayStat {
    date: String,
    count: u64,
}

#[derive(serde::Serialize)]
struct AppStat {
    date: String,
    app: String,
    count: u64,
}

#[derive(serde::Serialize)]
struct AppClickStat {
    date: String,
    app: String,
    left_clicks: u64,
    right_clicks: u64,
}

#[derive(serde::Serialize)]
struct UpdateStatus {
    current: String,
    latest: Option<String>,
    available: bool,
}

#[derive(serde::Serialize, Clone)]
struct UpdateAvailablePayload {
    current: String,
    latest: String,
}

enum WsEvent {
    Keystroke { app: String },
    Click { app: String, button: u8 },
    TypingStart,
    TypingStop,
}

#[tauri::command]
fn get_config(state: tauri::State<Arc<Mutex<config::Config>>>) -> config::Config {
    state.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
fn save_config(new_cfg: config::Config, state: tauri::State<Arc<Mutex<config::Config>>>) {
    config::save(&new_cfg);
    *state.lock().unwrap_or_else(|e| e.into_inner()) = new_cfg;
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
fn get_app_stats(days: usize, storage: tauri::State<storage::Storage>) -> Vec<AppStat> {
    storage
        .get_app_stats(days)
        .into_iter()
        .map(|(date, app, count)| AppStat { date, app, count })
        .collect()
}

#[tauri::command]
fn get_app_click_stats(days: usize, storage: tauri::State<storage::Storage>) -> Vec<AppClickStat> {
    storage
        .get_app_click_stats(days)
        .into_iter()
        .map(|(date, app, left_clicks, right_clicks)| AppClickStat {
            date,
            app,
            left_clicks,
            right_clicks,
        })
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
async fn install_update(
    app: AppHandle,
    storage: tauri::State<'_, storage::Storage>,
) -> Result<(), String> {
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
    storage.save();
    SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
    app.restart();
}

// ── macOS app icon ────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod app_icon {
    use base64::Engine;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

    fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
        CACHE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub fn get(app_name: &str) -> Option<String> {
        {
            let c = cache().lock().unwrap_or_else(|e| e.into_inner());
            if let Some(v) = c.get(app_name) {
                return v.clone();
            }
        }
        let result = fetch(app_name);
        cache()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(app_name.to_string(), result.clone());
        result
    }

    /// Resolve an app path from a bundle identifier or display name.
    /// Prefers `NSWorkspace.URLForApplicationWithBundleIdentifier` (works for
    /// bundle ids like `com.microsoft.VSCode`), then falls back to searching
    /// standard directories by `{name}.app` for the rare non-bundle-id case.
    fn find_app(app_id: &str) -> Option<String> {
        // Try NSWorkspace bundle-id lookup first (accurate, no filesystem scan).
        if let Some(path) = find_app_by_bundle_id(app_id) {
            return Some(path);
        }
        // Fallback: filesystem search for apps without a bundle id.
        let home = dirs::home_dir()?;
        let search_dirs = [
            "/Applications".to_string(),
            "/System/Applications".to_string(),
            "/System/Applications/Utilities".to_string(),
            format!("{}/Applications", home.display()),
        ];
        search_dirs.iter().find_map(|dir| {
            let path = format!("{}/{}.app", dir, app_id);
            std::path::Path::new(&path).exists().then_some(path)
        })
    }

    fn find_app_by_bundle_id(bundle_id: &str) -> Option<String> {
        use objc::runtime::{Class, Object};
        use objc::{msg_send, sel, sel_impl};
        unsafe {
            let ws_class = Class::get("NSWorkspace")?;
            let workspace: *mut Object = msg_send![ws_class, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let ns_str_class = Class::get("NSString")?;
            let c_str = std::ffi::CString::new(bundle_id).ok()?;
            let ns_bundle_id: *mut Object =
                msg_send![ns_str_class, stringWithUTF8String: c_str.as_ptr()];
            if ns_bundle_id.is_null() {
                return None;
            }
            let url: *mut Object =
                msg_send![workspace, URLForApplicationWithBundleIdentifier: ns_bundle_id];
            if url.is_null() {
                return None;
            }
            let path_obj: *mut Object = msg_send![url, path];
            if path_obj.is_null() {
                return None;
            }
            let utf8: *const std::os::raw::c_char = msg_send![path_obj, UTF8String];
            if utf8.is_null() {
                return None;
            }
            let s = std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
    }

    /// Return the localized display name for a bundle id using
    /// `NSFileManager.displayNameAtPath:` (e.g. "com.apple.dt.Xcode" → "Xcode").
    pub fn display_name(bundle_id: &str) -> Option<String> {
        use objc::runtime::{Class, Object};
        use objc::{msg_send, sel, sel_impl};
        let app_path = find_app_by_bundle_id(bundle_id)?;
        unsafe {
            let fm_class = Class::get("NSFileManager")?;
            let fm: *mut Object = msg_send![fm_class, defaultManager];
            if fm.is_null() {
                return None;
            }
            let ns_str_class = Class::get("NSString")?;
            let c_str = std::ffi::CString::new(app_path.as_str()).ok()?;
            let ns_path: *mut Object =
                msg_send![ns_str_class, stringWithUTF8String: c_str.as_ptr()];
            if ns_path.is_null() {
                return None;
            }
            let name_obj: *mut Object = msg_send![fm, displayNameAtPath: ns_path];
            if name_obj.is_null() {
                return None;
            }
            let utf8: *const std::os::raw::c_char = msg_send![name_obj, UTF8String];
            if utf8.is_null() {
                return None;
            }
            let raw = std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned();
            // Strip the ".app" extension that displayNameAtPath may include.
            let name = raw.strip_suffix(".app").unwrap_or(&raw).to_string();
            if name.is_empty() {
                None
            } else {
                Some(name)
            }
        }
    }

    fn icon_file(app_path: &str) -> Option<String> {
        let plist = format!("{}/Contents/Info.plist", app_path);
        let out = std::process::Command::new("defaults")
            .args(["read", &plist, "CFBundleIconFile"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let raw = String::from_utf8(out.stdout).ok()?;
        let name = raw.trim();
        let icon_name = if name.ends_with(".icns") {
            name.to_string()
        } else {
            format!("{}.icns", name)
        };
        let path = format!("{}/Contents/Resources/{}", app_path, icon_name);
        std::path::Path::new(&path).exists().then_some(path)
    }

    fn fetch(app_name: &str) -> Option<String> {
        let app_path = find_app(app_name)?;
        let icon_path = icon_file(&app_path)?;
        let safe_name = app_name.replace(|c: char| !c.is_alphanumeric(), "_");
        let tmp = format!("/tmp/kk-icon-{}.png", safe_name);
        let success = std::process::Command::new("sips")
            .args([
                "-s",
                "format",
                "png",
                &icon_path,
                "--out",
                &tmp,
                "--resampleHeightWidth",
                "64",
                "64",
            ])
            .output()
            .ok()
            .is_some_and(|o| o.status.success());
        if !success {
            return None;
        }
        let bytes = std::fs::read(&tmp).ok()?;
        std::fs::remove_file(&tmp).ok();
        Some(base64::engine::general_purpose::STANDARD.encode(bytes))
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_app_icon(app_name: String) -> Option<String> {
    app_icon::get(&app_name)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_app_icon(_app_name: String) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_app_display_name(app_name: String) -> Option<String> {
    app_icon::display_name(&app_name)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn get_app_display_name(_app_name: String) -> Option<String> {
    None
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

/// Create an NSString from a Rust &str (macOS only).
#[cfg(target_os = "macos")]
unsafe fn ns_string(s: &str) -> *mut objc::runtime::Object {
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};
    use std::ffi::CString;
    let c = CString::new(s).unwrap_or_default();
    let cls = Class::get("NSString").expect("NSString class");
    let obj: *mut Object = msg_send![cls, stringWithUTF8String: c.as_ptr()];
    obj
}

/// Show a native NSAlert asking the user to confirm quitting.
/// Returns `true` if the user clicked "Quit".
#[cfg(target_os = "macos")]
fn macos_confirm_quit() -> bool {
    use objc::runtime::{Class, Object, YES};
    use objc::{msg_send, sel, sel_impl};
    unsafe {
        // Bring the app to the front so the alert is visible.
        let app_cls = Class::get("NSApplication").expect("NSApplication class");
        let ns_app: *mut Object = msg_send![app_cls, sharedApplication];
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: YES];

        let alert_cls = Class::get("NSAlert").expect("NSAlert class");
        let alert: *mut Object = msg_send![alert_cls, new];
        let _: () = msg_send![alert, setMessageText: ns_string("Quit KeliKeli?")];
        let _: () = msg_send![alert, setInformativeText: ns_string(
            "KeliKeli runs in the background and tracks your activity. Quitting will stop all tracking."
        )];
        let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string("Quit")];
        let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string("Cancel")];

        // Set the app icon so the alert shows our icon instead of the
        // generic macOS document/folder icon.
        let app_icon: *mut Object = msg_send![ns_app, applicationIconImage];
        if !app_icon.is_null() {
            let _: () = msg_send![alert, setIcon: app_icon];
        }

        // NSAlertFirstButtonReturn = 1000  →  user clicked "Quit"
        let response: i64 = msg_send![alert, runModal];
        response == 1000
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
            get_app_stats,
            get_app_click_stats,
            get_autostart,
            set_autostart,
            check_update,
            install_update,
            get_app_icon,
            get_app_display_name
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
            tauri::async_runtime::spawn(startup_update_check(app.handle().clone(), auto_update));
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
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if SKIP_QUIT_DIALOG.load(Ordering::Relaxed) {
                    // Tray "Quit" path — skip the dialog, just let it exit.
                    return;
                }
                #[cfg(target_os = "macos")]
                {
                    if !macos_confirm_quit() {
                        api.prevent_exit();
                        return;
                    }
                }
                // Flush any unsaved stats before the process exits.
                if let Some(storage) = app_handle.try_state::<storage::Storage>() {
                    storage.save();
                }
            }
        });
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let initial = app.state::<storage::Storage>().today_count();
    let count = MenuItemBuilder::with_id("count", format!("Today: {initial} keystrokes"))
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
            "quit" => {
                #[cfg(target_os = "macos")]
                if !macos_confirm_quit() {
                    return;
                }
                app.state::<storage::Storage>().save();
                SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
                app.exit(0);
            }
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
        if let Ok(win) = tauri::WebviewWindowBuilder::new(
            app,
            "settings",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("KeliKeli Settings")
        .inner_size(660.0, 556.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .center()
        .build()
        {
            #[cfg(target_os = "macos")]
            setup_settings_window_rounded(&win);
        }
    }
}

/// Make the settings window background transparent and give it a 12-pt
/// corner radius using the NSWindow contentView's CALayer.
/// Does NOT change window level or collection behavior (unlike the indicator).
#[cfg(target_os = "macos")]
fn setup_settings_window_rounded(win: &tauri::WebviewWindow) {
    use objc::runtime::{Class, Object, NO, YES};
    use objc::{msg_send, sel, sel_impl};
    if let Ok(ptr) = win.ns_window() {
        unsafe {
            let ns_window = ptr as *mut Object;

            // Make the NSWindow itself transparent.
            let clear: *mut Object = msg_send![Class::get("NSColor").unwrap(), clearColor];
            let _: () = msg_send![ns_window, setOpaque: NO];
            let _: () = msg_send![ns_window, setBackgroundColor: clear];
            let _: () = msg_send![ns_window, setHasShadow: YES];

            // Apply corner radius to the contentView layer.
            let content: *mut Object = msg_send![ns_window, contentView];
            let _: () = msg_send![content, setWantsLayer: YES];
            let layer: *mut Object = msg_send![content, layer];
            let _: () = msg_send![layer, setCornerRadius: 12.0f64];
            let _: () = msg_send![layer, setMasksToBounds: YES];
        }
    }
}

fn build_tray_icon() -> TrayImage<'static> {
    let bytes = include_bytes!("../icons/32x32.png");
    TrayImage::from_bytes(bytes).expect("failed to load tray icon")
}

/// Check for updates at launch. If `auto_update` is true and an update
/// is available, download and install it immediately (app will restart).
/// Otherwise emit `"update_available"` so the UI can show a badge.
async fn startup_update_check(app: AppHandle, auto_update: bool) {
    use tauri_plugin_updater::UpdaterExt;
    // Small delay so the UI has time to finish initialising.
    tokio::time::sleep(Duration::from_secs(5)).await;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => return,
    };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        _ => return,
    };
    let current = app.package_info().version.to_string();
    let latest = update.version.clone();
    if auto_update {
        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
            // Flush activity data before the process is replaced, and tell the
            // ExitRequested handler to skip the quit-confirmation dialog — the
            // user already opted into silent auto-updates.
            if let Some(storage) = app.try_state::<storage::Storage>() {
                storage.save();
            }
            SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
            app.restart();
        }
    } else {
        app.emit(
            "update_available",
            UpdateAvailablePayload {
                current: current.clone(),
                latest: latest.clone(),
            },
        )
        .ok();
        #[cfg(target_os = "macos")]
        show_update_prompt(&app, &latest);
    }
}

/// Show a native NSAlert telling the user a new version is available.
/// Offers "Open Settings" (goes straight to the About tab) and "Later".
/// Uses NSAlert rather than the deprecated NSUserNotification API so the
/// prompt is always visible regardless of the system notification settings.
#[cfg(target_os = "macos")]
fn show_update_prompt(app: &AppHandle, version: &str) {
    use objc::runtime::{Class, Object, YES};
    use objc::{msg_send, sel, sel_impl};
    let app_handle = app.clone();
    let version_str = version.to_string();
    // Run on the main thread — NSAlert must be shown from the main thread.
    let _ = app.run_on_main_thread(move || unsafe {
        let app_cls = Class::get("NSApplication").expect("NSApplication class");
        let ns_app: *mut Object = msg_send![app_cls, sharedApplication];
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: YES];

        let alert_cls = Class::get("NSAlert").expect("NSAlert class");
        let alert: *mut Object = msg_send![alert_cls, new];
        let title = format!("KeliKeli {} is available", version_str);
        let _: () = msg_send![alert, setMessageText: ns_string(&title)];
        let _: () = msg_send![alert, setInformativeText: ns_string(
            "A new version is ready to install.\nOpen Settings \u{2192} About to update now."
        )];
        let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string("Open Settings")];
        let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string("Later")];

        let app_icon: *mut Object = msg_send![ns_app, applicationIconImage];
        if !app_icon.is_null() {
            let _: () = msg_send![alert, setIcon: app_icon];
        }

        // NSAlertFirstButtonReturn = 1000  →  user clicked "Open Settings"
        let response: i64 = msg_send![alert, runModal];
        if response == 1000 {
            open_settings_window(&app_handle);
        }
    });
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
                            tx.send(WsEvent::Click {
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
                                tx.send(WsEvent::TypingStart).ok();
                            }
                        }
                        if let Some(tx) = &ws_tx {
                            tx.send(WsEvent::Keystroke { app: app_name.clone() }).ok();
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
                            if macos_confirm_quit() {
                                storage_h.save();
                                // Skip the ExitRequested dialog — user already confirmed.
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
                    tx.send(WsEvent::TypingStop).ok();
                }
            }
        }
    }
}

/// Snapshot of cumulative counts used to compute the per-interval delta.
#[derive(Default, Clone, Copy)]
struct SyncSnapshot {
    keystrokes: u64,
    left_clicks: u64,
    right_clicks: u64,
}

async fn do_sync(
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

async fn sync_loop(storage: storage::Storage, cfg: config::SyncConfig) {
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

async fn ws_loop(mut rx: mpsc::UnboundedReceiver<WsEvent>, url: String) {
    use tokio_tungstenite::tungstenite::Message;
    let mut pending: Option<serde_json::Value> = None;
    let mut retry_delay = Duration::from_secs(2);
    const MAX_RETRY_DELAY: Duration = Duration::from_secs(300);

    loop {
        let Ok((ws, _)) = tokio_tungstenite::connect_async(&url).await else {
            tokio::time::sleep(retry_delay).await;
            retry_delay = (retry_delay * 2).min(MAX_RETRY_DELAY);
            continue;
        };
        retry_delay = Duration::from_secs(2);
        let (mut write, mut read) = ws.split();

        // Retry the message that failed on the previous connection before
        // reading new events from the channel.
        if let Some(payload) = pending.take() {
            if write
                .send(Message::Text(payload.to_string()))
                .await
                .is_err()
            {
                pending = Some(payload);
                continue;
            }
        }

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(event) => {
                            let payload = match event {
                                WsEvent::Keystroke { app } => {
                                    serde_json::json!({ "type": "keystroke", "app": app })
                                }
                                WsEvent::Click { app, button } => {
                                    let click_type =
                                        if button == 0 { "left_click" } else { "right_click" };
                                    serde_json::json!({ "type": click_type, "app": app })
                                }
                                WsEvent::TypingStart => {
                                    serde_json::json!({ "type": "typing_start" })
                                }
                                WsEvent::TypingStop => {
                                    serde_json::json!({ "type": "typing_stop" })
                                }
                            };
                            if write
                                .send(Message::Text(payload.to_string()))
                                .await
                                .is_err()
                            {
                                pending = Some(payload);
                                break;
                            }
                        }
                        None => return,
                    }
                }
                // Detect server-initiated close or connection reset via the read
                // half — a write-only loop would never see a graceful FIN until
                // the next send attempt, causing a stale connection to linger.
                _ = read.next() => break,
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
        let prev = SyncSnapshot::default(); // zero baseline → delta == totals
        do_sync(&client, &storage, &test_sync_cfg(&server.url()), &prev).await;

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_delta_reflects_activity_since_last_sync() {
        let mut server = mockito::Server::new_async().await;

        // Totals: 10 keystrokes; prev was 7 → delta should be 3
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

        // Two syncs despite 500 responses — should not panic
        do_sync(&client, &storage, &cfg, &prev).await;
        do_sync(&client, &storage, &cfg, &prev).await;

        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sync_rejects_non_http_url() {
        let (_dir, storage) = temp_storage();
        let client = reqwest::Client::new();

        // None of these should panic or make a network request.
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

    // ── ws_loop tests ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn ws_connects_and_delivers_keystroke_event() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::Keystroke {
            app: "Xcode".into(),
        })
        .unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        let val = parse_ws_msg(&msg);
        assert_eq!(val["type"], "keystroke");
        assert_eq!(val["app"], "Xcode");
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
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&start_msg)["type"], "typing_start");

        let stop_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
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
            .await
            .unwrap()
            .unwrap();
        let mut ws1 = accept_async(s1).await.unwrap();

        // Send and receive event 1
        tx.send(WsEvent::Keystroke {
            app: "Terminal".into(),
        })
        .unwrap();
        let msg1 = tokio::time::timeout(Duration::from_secs(2), ws1.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&msg1)["type"], "keystroke");

        // Drop the server side. ws_loop's select! is also polling read.next(),
        // so it detects the TCP FIN immediately — no sleep needed.
        drop(ws1);

        // listener.accept() acts as the synchronization point: it only returns
        // once ws_loop has actually reconnected, so any events we send after
        // this point are guaranteed to land on the new connection.
        let (s2, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws2 = accept_async(s2).await.unwrap();

        tx.send(WsEvent::Keystroke {
            app: "Terminal".into(),
        })
        .unwrap();
        tx.send(WsEvent::Keystroke {
            app: "Terminal".into(),
        })
        .unwrap();

        let msg2 = tokio::time::timeout(Duration::from_secs(2), ws2.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&msg2)["type"], "keystroke");

        let msg3 = tokio::time::timeout(Duration::from_secs(2), ws2.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&msg3)["type"], "keystroke");
    }

    #[tokio::test]
    async fn ws_delivers_left_and_right_click_events() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::Click {
            app: "Finder".into(),
            button: 0,
        })
        .unwrap();
        tx.send(WsEvent::Click {
            app: "Safari".into(),
            button: 1,
        })
        .unwrap();

        let left_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let left = parse_ws_msg(&left_msg);
        assert_eq!(left["type"], "left_click");
        assert_eq!(left["app"], "Finder");

        let right_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let right = parse_ws_msg(&right_msg);
        assert_eq!(right["type"], "right_click");
        assert_eq!(right["app"], "Safari");
    }
}
