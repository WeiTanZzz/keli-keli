use tokio::sync::mpsc;

#[derive(Debug)]
pub enum KeyEvent {
    KeyPress { app: String },
    MouseClick { app: String },
}

pub fn start(tx: mpsc::UnboundedSender<KeyEvent>) {
    use std::os::raw::c_void;
    use std::sync::OnceLock;

    static SENDER: OnceLock<mpsc::UnboundedSender<KeyEvent>> = OnceLock::new();
    let _ = SENDER.set(tx);

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

        const KEY_DOWN_MASK: u64 = 1 << 10;
        // kCGEventLeftMouseDown=1, kCGEventRightMouseDown=3, kCGEventOtherMouseDown=25
        const MOUSE_DOWN_MASK: u64 = (1 << 1) | (1 << 3) | (1 << 25);
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
        }

        static TAP_PORT: std::sync::atomic::AtomicPtr<c_void> =
            std::sync::atomic::AtomicPtr::new(std::ptr::null_mut());

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
            let name: *mut Object = msg_send![app, localizedName];
            if name.is_null() {
                return "Unknown".to_string();
            }
            let utf8: *const std::os::raw::c_char = msg_send![name, UTF8String];
            if utf8.is_null() {
                return "Unknown".to_string();
            }
            std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned()
        }

        unsafe extern "C" fn tap_callback(
            _proxy: CGEventTapProxy,
            event_type: u32,
            event: CGEventRef,
            _user_info: *mut c_void,
        ) -> CGEventRef {
            if event_type == 0xFFFFFFFE || event_type == 0xFFFFFFFF {
                let tap = TAP_PORT.load(std::sync::atomic::Ordering::Relaxed);
                if !tap.is_null() {
                    CGEventTapEnable(tap, true);
                }
                return event;
            }
            if event_type == 10 {
                if let Some(tx) = SENDER.get() {
                    let app = frontmost_app_name();
                    let _ = tx.send(KeyEvent::KeyPress { app });
                }
            } else if event_type == 1 || event_type == 3 || event_type == 25 {
                if let Some(tx) = SENDER.get() {
                    let app = frontmost_app_name();
                    let _ = tx.send(KeyEvent::MouseClick { app });
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

                // Release the previous tap port before overwriting, so we don't
                // leak CFMachPortRef objects if CFRunLoopRun() ever returns.
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
                // Release our source reference — the run loop holds its own retain.
                CFRelease(source);
                CGEventTapEnable(tap, true);
                CFRunLoopRun();
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
    });
}
