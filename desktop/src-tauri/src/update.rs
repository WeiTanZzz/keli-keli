use crate::storage;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::Duration;

#[derive(serde::Serialize, Clone)]
pub(crate) struct UpdateAvailablePayload {
    pub(crate) current: String,
    pub(crate) latest: String,
}

/// Check for updates at launch. If `auto_update` is true and an update
/// is available, download and install it immediately (app will restart).
/// Otherwise emit `"update_available"` so the UI can show a badge.
pub(crate) async fn startup_update_check(app: AppHandle, auto_update: bool) {
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
            crate::SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
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

/// Manual update check triggered from the tray menu.
/// Shows a native dialog for each outcome: update available, up to date, or error.
pub(crate) async fn check_for_updates_manual(app: &AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => {
            #[cfg(target_os = "macos")]
            show_alert(
                app,
                "Update Check Failed",
                "Could not reach the update server.",
            );
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            #[cfg(target_os = "macos")]
            show_update_prompt(app, &update.version);
        }
        Ok(None) => {
            #[cfg(target_os = "macos")]
            {
                let version = app.package_info().version.to_string();
                show_alert(
                    app,
                    "KeliKeli is up to date",
                    &format!("Version {version} is the latest version."),
                );
            }
        }
        Err(_) => {
            #[cfg(target_os = "macos")]
            show_alert(
                app,
                "Update Check Failed",
                "Could not reach the update server.",
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn show_alert(app: &AppHandle, title: &str, message: &str) {
    use crate::platform::macos::ns_string;
    use objc::runtime::{Class, Object, YES};
    use objc::{msg_send, sel, sel_impl};
    let title = title.to_string();
    let message = message.to_string();
    let _ = app.run_on_main_thread(move || unsafe {
        let app_cls = Class::get("NSApplication").expect("NSApplication class");
        let ns_app: *mut Object = msg_send![app_cls, sharedApplication];
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: YES];

        let alert_cls = Class::get("NSAlert").expect("NSAlert class");
        let alert: *mut Object = msg_send![alert_cls, new];
        let _: () = msg_send![alert, setMessageText: ns_string(&title)];
        let _: () = msg_send![alert, setInformativeText: ns_string(&message)];
        let _: *mut Object = msg_send![alert, addButtonWithTitle: ns_string("OK")];
        let _: i64 = msg_send![alert, runModal];
    });
}

/// Show a native NSAlert telling the user a new version is available.
/// Offers "Open Settings" (goes straight to the About tab) and "Later".
#[cfg(target_os = "macos")]
fn show_update_prompt(app: &AppHandle, version: &str) {
    use crate::platform::macos::{ns_string, NS_ALERT_FIRST_BUTTON};
    use crate::tray::open_settings_window;
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

        let response: i64 = msg_send![alert, runModal];
        if response == NS_ALERT_FIRST_BUTTON {
            open_settings_window(&app_handle);
        }
    });
}
