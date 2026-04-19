// All code in this file is macOS-only.
// Non-macOS platforms see nothing from this module.

// NSAlertFirstButtonReturn — the return value of NSAlert.runModal() when the
// first (leftmost) button is clicked.
pub(crate) const NS_ALERT_FIRST_BUTTON: i64 = 1000;

// NSWindowCollectionBehavior flags used for the floating indicator window.
// CanJoinAllSpaces(1) keeps it visible on every Space.
// Stationary(16) prevents Mission Control from moving it.
// FullScreenAuxiliary(256) lets it overlay full-screen apps.
pub(crate) const NS_WINDOW_COLLECTION_BEHAVIOR: usize = 1 | 16 | 256;

// Window level high enough to appear above full-screen apps on all Spaces.
pub(crate) const INDICATOR_WINDOW_LEVEL: i64 = 10000;

// ── App icon resolution ───────────────────────────────────────────────────────

pub(crate) mod app_icon {
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
        if let Some(path) = find_app_by_bundle_id(app_id) {
            return Some(path);
        }
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

// ── Shared NSString helper ────────────────────────────────────────────────────

/// Create an NSString from a Rust &str.
pub(crate) unsafe fn ns_string(s: &str) -> *mut objc::runtime::Object {
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};
    use std::ffi::CString;
    let c = CString::new(s).unwrap_or_default();
    let cls = Class::get("NSString").expect("NSString class");
    let obj: *mut Object = msg_send![cls, stringWithUTF8String: c.as_ptr()];
    obj
}

// ── Quit confirmation dialog ──────────────────────────────────────────────────

/// Show a native NSAlert asking the user to confirm quitting.
/// Returns `true` if the user clicked "Quit".
pub(crate) fn macos_confirm_quit() -> bool {
    use objc::runtime::{Class, Object, YES};
    use objc::{msg_send, sel, sel_impl};
    unsafe {
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

        let app_icon: *mut Object = msg_send![ns_app, applicationIconImage];
        if !app_icon.is_null() {
            let _: () = msg_send![alert, setIcon: app_icon];
        }

        let response: i64 = msg_send![alert, runModal];
        response == NS_ALERT_FIRST_BUTTON
    }
}

// ── Window helpers ────────────────────────────────────────────────────────────

pub(crate) fn make_webview_transparent(win: &tauri::WebviewWindow) {
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
            let _: () = msg_send![ns_window, setHasShadow: NO];
            let _: () = msg_send![ns_window, setLevel: INDICATOR_WINDOW_LEVEL];
            let existing: usize = msg_send![ns_window, collectionBehavior];
            let _: () = msg_send![ns_window, setCollectionBehavior: existing | NS_WINDOW_COLLECTION_BEHAVIOR];
        }
    }
}

/// Make the settings window background transparent and give it a 12-pt
/// corner radius using the NSWindow contentView's CALayer.
/// Does NOT change window level or collection behavior (unlike the indicator).
pub(crate) fn setup_settings_window_rounded(win: &tauri::WebviewWindow) {
    use objc::runtime::{Class, Object, NO, YES};
    use objc::{msg_send, sel, sel_impl};
    if let Ok(ptr) = win.ns_window() {
        unsafe {
            let ns_window = ptr as *mut Object;
            let clear: *mut Object = msg_send![Class::get("NSColor").unwrap(), clearColor];
            let _: () = msg_send![ns_window, setOpaque: NO];
            let _: () = msg_send![ns_window, setBackgroundColor: clear];
            let _: () = msg_send![ns_window, setHasShadow: YES];
            let content: *mut Object = msg_send![ns_window, contentView];
            let _: () = msg_send![content, setWantsLayer: YES];
            let layer: *mut Object = msg_send![content, layer];
            let _: () = msg_send![layer, setCornerRadius: 12.0f64];
            let _: () = msg_send![layer, setMasksToBounds: YES];
        }
    }
}
