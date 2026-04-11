use tokio::sync::mpsc;

#[derive(Debug)]
pub enum KeyEvent {
    KeyPress,
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

        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            fn CGEventTapCreate(
                tap: u32,
                place: u32,
                options: u32,
                events_of_interest: u64,
                callback: unsafe extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef,
                user_info: *mut c_void,
            ) -> CFMachPortRef;
            fn CFMachPortCreateRunLoopSource(
                allocator: CFAllocatorRef,
                port: CFMachPortRef,
                order: CFIndex,
            ) -> CFRunLoopSourceRef;
            fn CFRunLoopGetCurrent() -> CFRunLoopRef;
            fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
            fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
            fn CFRunLoopRun();
            static kCFRunLoopCommonModes: CFRunLoopMode;
        }

        static TAP_PORT: std::sync::atomic::AtomicPtr<c_void> =
            std::sync::atomic::AtomicPtr::new(std::ptr::null_mut());

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
                    let _ = tx.send(KeyEvent::KeyPress);
                }
            }
            event
        }

        loop {
            unsafe {
                let tap = CGEventTapCreate(0, 0, 1, KEY_DOWN_MASK, tap_callback, std::ptr::null_mut());
                if tap.is_null() {
                    eprintln!("[keli] CGEventTapCreate failed — System Settings → Privacy & Security → Input Monitoring");
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    continue;
                }
                TAP_PORT.store(tap, std::sync::atomic::Ordering::Relaxed);
                let source = CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap, 0);
                if source.is_null() {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    continue;
                }
                let rl = CFRunLoopGetCurrent();
                CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
                CGEventTapEnable(tap, true);
                CFRunLoopRun();
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
    });
}
