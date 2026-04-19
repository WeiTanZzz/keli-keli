use crate::{config, storage};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

// ── Response types ────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub(crate) struct DayStat {
    pub(crate) date: String,
    pub(crate) count: u64,
}

#[derive(serde::Serialize)]
pub(crate) struct AppStat {
    pub(crate) date: String,
    pub(crate) app: String,
    pub(crate) count: u64,
}

#[derive(serde::Serialize)]
pub(crate) struct AppClickStat {
    pub(crate) date: String,
    pub(crate) app: String,
    pub(crate) left_clicks: u64,
    pub(crate) right_clicks: u64,
}

#[derive(serde::Serialize)]
pub(crate) struct UpdateStatus {
    pub(crate) current: String,
    pub(crate) latest: Option<String>,
    pub(crate) available: bool,
}

#[derive(serde::Serialize)]
pub(crate) struct AllTimeCounts {
    pub(crate) keystrokes: u64,
    pub(crate) left_clicks: u64,
    pub(crate) right_clicks: u64,
}

// ── Config commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_config(state: tauri::State<Arc<Mutex<config::Config>>>) -> config::Config {
    state.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub(crate) fn save_config(
    new_cfg: config::Config,
    state: tauri::State<Arc<Mutex<config::Config>>>,
    app: AppHandle,
) {
    config::save(&new_cfg);
    *state.lock().unwrap_or_else(|e| e.into_inner()) = new_cfg.clone();
    let _ = app.emit("config_changed", new_cfg);
}

#[tauri::command]
pub(crate) fn save_config_and_restart(
    new_cfg: config::Config,
    state: tauri::State<Arc<Mutex<config::Config>>>,
    storage: tauri::State<'_, crate::storage::Storage>,
    app: AppHandle,
) {
    config::save(&new_cfg);
    *state.lock().unwrap_or_else(|e| e.into_inner()) = new_cfg;
    storage.save();
    crate::SKIP_QUIT_DIALOG.store(true, std::sync::atomic::Ordering::Relaxed);
    app.restart();
}

// ── Stats commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_all_time_counts(storage: tauri::State<storage::Storage>) -> AllTimeCounts {
    let (keystrokes, left_clicks, right_clicks) = storage.all_time_counts();
    AllTimeCounts {
        keystrokes,
        left_clicks,
        right_clicks,
    }
}

#[tauri::command]
pub(crate) fn get_stats(days: usize, storage: tauri::State<storage::Storage>) -> Vec<DayStat> {
    storage
        .get_stats(days)
        .into_iter()
        .map(|(date, count)| DayStat { date, count })
        .collect()
}

#[tauri::command]
pub(crate) fn get_app_stats(days: usize, storage: tauri::State<storage::Storage>) -> Vec<AppStat> {
    storage
        .get_app_stats(days)
        .into_iter()
        .map(|(date, app, count)| AppStat { date, app, count })
        .collect()
}

#[tauri::command]
pub(crate) fn get_app_click_stats(
    days: usize,
    storage: tauri::State<storage::Storage>,
) -> Vec<AppClickStat> {
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

// ── Update commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) async fn check_update(app: AppHandle) -> Result<UpdateStatus, String> {
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
pub(crate) async fn install_update(
    app: AppHandle,
    storage: tauri::State<'_, storage::Storage>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
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
    crate::SKIP_QUIT_DIALOG.store(true, Ordering::Relaxed);
    app.restart();
}

// ── App icon commands ─────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn get_app_icon(app_name: String) -> Option<String> {
    crate::macos::app_icon::get(&app_name)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn get_app_icon(_app_name: String) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn get_app_display_name(app_name: String) -> Option<String> {
    crate::macos::app_icon::display_name(&app_name)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub(crate) fn get_app_display_name(_app_name: String) -> Option<String> {
    None
}

// ── Autostart commands ────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub(crate) fn set_autostart(app: AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable().ok();
    } else {
        app.autolaunch().disable().ok();
    }
}
