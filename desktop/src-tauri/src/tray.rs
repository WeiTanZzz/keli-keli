use crate::storage;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{
    image::Image as TrayImage,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

// Re-export menu item types as state wrappers so lib.rs can manage them.
pub(crate) struct CountItem(pub(crate) Mutex<tauri::menu::MenuItem<Wry>>);
pub(crate) struct ToggleItem(pub(crate) Mutex<tauri::menu::MenuItem<Wry>>);

pub(crate) fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let initial = app.state::<storage::Storage>().today_count();
    let count = MenuItemBuilder::with_id("count", format!("Today: {initial} keystrokes"))
        .enabled(false)
        .build(app)?;
    let sep0 = PredefinedMenuItem::separator(app)?;
    let toggle = MenuItemBuilder::with_id("toggle", "Hide Indicator").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let version_str = app.package_info().version.to_string();
    let version = MenuItemBuilder::with_id("version", format!("Version {version_str}"))
        .enabled(false)
        .build(app)?;
    let check_updates =
        MenuItemBuilder::with_id("check_updates", "Check for Updates…").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit KeliKeli").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &count,
            &sep0,
            &toggle,
            &settings,
            &sep1,
            &version,
            &check_updates,
            &sep2,
            &quit,
        ])
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
            "check_updates" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::update::check_for_updates_manual(&app).await;
                });
            }
            "quit" => {
                #[cfg(target_os = "macos")]
                if !crate::macos::macos_confirm_quit() {
                    return;
                }
                app.state::<storage::Storage>().save();
                crate::SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub(crate) fn open_settings_window(app: &AppHandle) {
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
            crate::macos::setup_settings_window_rounded(&win);
        }
    }
}

fn build_tray_icon() -> TrayImage<'static> {
    let bytes = include_bytes!("../icons/tray.png");
    TrayImage::from_bytes(bytes).expect("failed to load tray icon")
}
