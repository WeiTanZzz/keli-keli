use tokio::sync::mpsc;

#[derive(Debug)]
pub enum KeyEvent {
    KeyPress {
        app: String,
    },
    /// button: 0 = left, 1 = right, 2 = other/middle
    MouseClick {
        app: String,
        button: u8,
    },
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

        /// Return a canonical display name for a bundle identifier.
        /// Falls back to `None` when the bundle id is not in the table so
        /// the caller can use the OS-provided `localizedName` instead.
        fn canonical_name(bundle_id: &str) -> Option<&'static str> {
            // Strip optional ".debug" / "-dev" suffix variants some apps append
            let id = bundle_id.trim_end_matches(".debug");
            match id {
                // Microsoft
                "com.microsoft.VSCode" | "com.microsoft.VSCodeInsiders" => {
                    Some("Visual Studio Code")
                }
                "com.microsoft.edgemac" => Some("Microsoft Edge"),
                "com.microsoft.teams2" | "com.microsoft.teams" => Some("Microsoft Teams"),
                "com.microsoft.Word" => Some("Microsoft Word"),
                "com.microsoft.Excel" => Some("Microsoft Excel"),
                "com.microsoft.Powerpoint" => Some("Microsoft PowerPoint"),
                "com.microsoft.Outlook" => Some("Microsoft Outlook"),
                "com.microsoft.onenote.mac" => Some("Microsoft OneNote"),
                // JetBrains
                "com.jetbrains.intellij" | "com.jetbrains.intellij.ce" => Some("IntelliJ IDEA"),
                "com.jetbrains.pycharm" | "com.jetbrains.pycharm.ce" => Some("PyCharm"),
                "com.jetbrains.goland" => Some("GoLand"),
                "com.jetbrains.CLion" => Some("CLion"),
                "com.jetbrains.webstorm" => Some("WebStorm"),
                "com.jetbrains.datagrip" => Some("DataGrip"),
                "com.jetbrains.rider" => Some("Rider"),
                "com.jetbrains.rubymine" => Some("RubyMine"),
                "com.jetbrains.fleet" => Some("Fleet"),
                "com.jetbrains.PhpStorm" => Some("PhpStorm"),
                "com.jetbrains.RustRover" => Some("RustRover"),
                // Editors / IDEs
                "com.sublimetext.4" | "com.sublimetext.3" | "com.sublimetext.2" => {
                    Some("Sublime Text")
                }
                "io.cursor.Cursor" | "com.todesktop.230313mzl4w4u92" => Some("Cursor"),
                "com.neovide.neovide" => Some("Neovide"),
                "dev.zed.Zed" | "dev.zed.Zed-Preview" => Some("Zed"),
                "com.apple.dt.Xcode" => Some("Xcode"),
                // Terminals
                "com.googlecode.iterm2" => Some("iTerm2"),
                "net.kovidgoyal.kitty" => Some("kitty"),
                "com.github.wez.wezterm" => Some("WezTerm"),
                "dev.alacritty.Alacritty" => Some("Alacritty"),
                // Browsers
                "com.google.Chrome" => Some("Google Chrome"),
                "com.google.Chrome.canary" => Some("Google Chrome Canary"),
                "org.mozilla.firefox" => Some("Firefox"),
                "com.brave.Browser" => Some("Brave Browser"),
                "com.operasoftware.Opera" => Some("Opera"),
                "com.vivaldi.Vivaldi" => Some("Vivaldi"),
                "com.apple.Safari" => Some("Safari"),
                "company.thebrowser.Browser" => Some("Arc"),
                // Communication
                "com.tencent.xinWeChat" => Some("WeChat"),
                "com.tencent.QQMacOS" => Some("QQ"),
                "com.bytedance.feishu" => Some("Feishu"),
                "com.dingtalk.macos.mainApp" => Some("DingTalk"),
                "com.hnc.Discord" => Some("Discord"),
                "com.tinyspeck.slackmacgap" => Some("Slack"),
                "com.facebook.archon" | "com.facebook.Messenger" => Some("Messenger"),
                "com.telegram.desktop" | "ru.keepcoder.Telegram" => Some("Telegram"),
                // Productivity
                "com.notion.id" => Some("Notion"),
                "md.obsidian" | "com.obsidian.md" => Some("Obsidian"),
                "com.figma.Desktop" => Some("Figma"),
                "com.linear.linear" => Some("Linear"),
                "com.github.GitHubDesktop" => Some("GitHub Desktop"),
                "com.sourcetreeapp.SourceTree" => Some("Sourcetree"),
                "org.gitkraken.gitkraken" => Some("GitKraken"),
                "com.postmanlabs.mac" => Some("Postman"),
                "io.insomnia.desktop" => Some("Insomnia"),
                "com.docker.docker" => Some("Docker Desktop"),
                _ => None,
            }
        }

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

            // Try bundle identifier first — it is stable across renames/locales.
            let bundle_id_obj: *mut Object = msg_send![app, bundleIdentifier];
            if let Some(bundle_id) = ns_string_to_rust(bundle_id_obj) {
                if let Some(name) = canonical_name(&bundle_id) {
                    return name.to_string();
                }
            }

            // Fall back to the OS-provided localised name.
            let name_obj: *mut Object = msg_send![app, localizedName];
            ns_string_to_rust(name_obj).unwrap_or_else(|| "Unknown".to_string())
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
                    // 1=left, 3=right, 25=other/middle
                    let button = if event_type == 1 {
                        0
                    } else if event_type == 3 {
                        1
                    } else {
                        2
                    };
                    let _ = tx.send(KeyEvent::MouseClick { app, button });
                }
            }
            event
        }

        loop {
            unsafe {
                let tap = CGEventTapCreate(0, 0, 1, EVENT_MASK, tap_callback, std::ptr::null_mut());
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
