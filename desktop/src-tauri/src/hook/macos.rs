use std::os::raw::c_void;

use super::{KeyEvent, SENDER};

pub(super) fn start() {
    std::thread::spawn(move || {
        #[allow(non_camel_case_types)]
        type CGEventTapProxy = *mut c_void;
        #[allow(non_camel_case_types)]
        type CGEventRef = *mut c_void;
        #[allow(non_camel_case_types)]
        type CFMachPortRef = *mut c_void;
        #[allow(non_camel_case_types)]
        type CFRunLoopSourceRef = *mut c_void;
        #[allow(non_camel_case_types)]
        type CFRunLoopRef = *mut c_void;
        #[allow(non_camel_case_types)]
        type CFAllocatorRef = *mut c_void;
        #[allow(non_camel_case_types)]
        type CFRunLoopMode = *const c_void;
        #[allow(non_camel_case_types)]
        type CFIndex = std::os::raw::c_long;

        const KEY_DOWN: u32 = 10;
        const LEFT_MOUSE_DOWN: u32 = 1;
        const RIGHT_MOUSE_DOWN: u32 = 3;
        const OTHER_MOUSE_DOWN: u32 = 25;
        const TAP_DISABLED: u32 = 0xFFFFFFFE;
        const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFF;

        const KEY_DOWN_MASK: u64 = 1 << KEY_DOWN;
        const MOUSE_DOWN_MASK: u64 =
            (1 << LEFT_MOUSE_DOWN) | (1 << RIGHT_MOUSE_DOWN) | (1 << OTHER_MOUSE_DOWN);
        const EVENT_MASK: u64 = KEY_DOWN_MASK | MOUSE_DOWN_MASK;

        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventTapCreate(
                tap: u32,
                place: u32,
                options: u32,
                events_of_interest: u64,
                callback: unsafe extern "C" fn(
                    CGEventTapProxy,
                    u32,
                    CGEventRef,
                    *mut c_void,
                ) -> CGEventRef,
                user_info: *mut c_void,
            ) -> CFMachPortRef;
            fn CFMachPortCreateRunLoopSource(
                allocator: CFAllocatorRef,
                port: CFMachPortRef,
                order: CFIndex,
            ) -> CFRunLoopSourceRef;
            fn CFRunLoopGetCurrent() -> CFRunLoopRef;
            fn CFRunLoopAddSource(
                rl: CFRunLoopRef,
                source: CFRunLoopSourceRef,
                mode: CFRunLoopMode,
            );
            fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
            fn CFRunLoopRun();
            fn CFRelease(cf: *const c_void);
            static kCFRunLoopCommonModes: CFRunLoopMode;
            fn CGEventGetFlags(event: CGEventRef) -> u64;
            fn CGEventGetIntegerValueField(event: CGEventRef, field: i32) -> i64;
        }

        static TAP_PORT: std::sync::atomic::AtomicPtr<c_void> =
            std::sync::atomic::AtomicPtr::new(std::ptr::null_mut());

        unsafe fn ns_string_to_rust(obj: *mut objc::runtime::Object) -> Option<String> {
            use objc::{msg_send, sel, sel_impl};
            if obj.is_null() {
                return None;
            }
            let utf8: *const std::os::raw::c_char = msg_send![obj, UTF8String];
            if utf8.is_null() {
                return None;
            }
            Some(
                std::ffi::CStr::from_ptr(utf8)
                    .to_string_lossy()
                    .into_owned(),
            )
        }

        unsafe fn frontmost_app_name() -> String {
            use objc::runtime::{Class, Object};
            use objc::{msg_send, sel, sel_impl};
            let ws_class = match Class::get("NSWorkspace") {
                Some(c) => c,
                None => return "Unknown".to_string(),
            };
            let workspace: *mut Object = msg_send![ws_class, sharedWorkspace];
            if workspace.is_null() {
                return "Unknown".to_string();
            }
            let app: *mut Object = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return "Unknown".to_string();
            }
            // Use bundleIdentifier as the primary key — stable, unique,
            // and locale-independent. Falls back to localizedName for
            // apps that ship without a bundle id (e.g. scripts, CLI wrappers).
            let bundle_id_obj: *mut Object = msg_send![app, bundleIdentifier];
            if let Some(id) = ns_string_to_rust(bundle_id_obj) {
                if !id.is_empty() {
                    return id;
                }
            }
            let name_obj: *mut Object = msg_send![app, localizedName];
            ns_string_to_rust(name_obj).unwrap_or_else(|| "Unknown".to_string())
        }

        unsafe extern "C" fn tap_callback(
            _proxy: CGEventTapProxy,
            event_type: u32,
            event: CGEventRef,
            _user_info: *mut c_void,
        ) -> CGEventRef {
            if event_type == TAP_DISABLED || event_type == TAP_DISABLED_BY_TIMEOUT {
                let tap = TAP_PORT.load(std::sync::atomic::Ordering::Relaxed);
                if !tap.is_null() {
                    CGEventTapEnable(tap, true);
                }
                return event;
            }
            if event_type == KEY_DOWN {
                // Skip key-repeat events (field 8 = kCGKeyboardEventAutorepeat).
                if CGEventGetIntegerValueField(event, 8) != 0 {
                    return event;
                }
                // Intercept Cmd+Q only when KeliKeli itself is the active app.
                let flags = CGEventGetFlags(event);
                let keycode = CGEventGetIntegerValueField(event, 9);
                if (flags & 0x00100000) != 0 && keycode == 12 {
                    use objc::runtime::{Class, Object};
                    use objc::{msg_send, sel, sel_impl};
                    let ns_app_cls = Class::get("NSApplication");
                    let is_active = ns_app_cls.is_some_and(|cls| {
                        let ns_app: *mut Object = msg_send![cls, sharedApplication];
                        let active: bool = msg_send![ns_app, isActive];
                        active
                    });
                    if is_active {
                        if let Some(tx) = SENDER.get() {
                            let _ = tx.send(KeyEvent::CmdQ);
                        }
                        return std::ptr::null_mut();
                    }
                }
                if let Some(tx) = SENDER.get() {
                    let app = frontmost_app_name();
                    let _ = tx.send(KeyEvent::KeyPress { app });
                }
            } else if event_type == LEFT_MOUSE_DOWN
                || event_type == RIGHT_MOUSE_DOWN
                || event_type == OTHER_MOUSE_DOWN
            {
                if let Some(tx) = SENDER.get() {
                    let app = frontmost_app_name();
                    let button = match event_type {
                        LEFT_MOUSE_DOWN => 0,
                        RIGHT_MOUSE_DOWN => 1,
                        _ => 2,
                    };
                    let _ = tx.send(KeyEvent::MouseClick { app, button });
                }
            }
            event
        }

        loop {
            unsafe {
                let tap =
                    CGEventTapCreate(0, 0, 1, EVENT_MASK, tap_callback, std::ptr::null_mut());
                if tap.is_null() {
                    static PROMPTED: std::sync::atomic::AtomicBool =
                        std::sync::atomic::AtomicBool::new(false);
                    if !PROMPTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                        std::process::Command::new("open")
                            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
                            .spawn()
                            .ok();
                    }
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    continue;
                }

                let old = TAP_PORT.swap(tap, std::sync::atomic::Ordering::Relaxed);
                if !old.is_null() {
                    CFRelease(old);
                }

                let source = CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap, 0);
                if source.is_null() {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    continue;
                }
                let rl = CFRunLoopGetCurrent();
                CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
                CFRelease(source);
                CGEventTapEnable(tap, true);
                CFRunLoopRun();
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
    });
}
