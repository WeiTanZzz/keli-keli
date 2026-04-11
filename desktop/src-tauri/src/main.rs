// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    set_macos_activation_policy_accessory();

    keli_keli_lib::run();
}

#[cfg(target_os = "macos")]
fn set_macos_activation_policy_accessory() {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let app: *mut Object = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, setActivationPolicy: 1_i64];
    }
}
