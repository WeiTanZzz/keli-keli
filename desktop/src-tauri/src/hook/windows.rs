use std::os::raw::c_void;

use super::{KeyEvent, SENDER};

pub(super) fn start() {
    std::thread::spawn(move || {
        type HWND = *mut c_void;
        type HHOOK = *mut c_void;
        type WPARAM = usize;
        type LPARAM = isize;
        type LRESULT = isize;
        type HOOKPROC = unsafe extern "system" fn(i32, WPARAM, LPARAM) -> LRESULT;

        const WH_KEYBOARD_LL: i32 = 13;
        const WH_MOUSE_LL: i32 = 14;
        const HC_ACTION: i32 = 0;
        const WM_KEYDOWN: usize = 0x0100;
        const WM_SYSKEYDOWN: usize = 0x0104;
        const WM_LBUTTONDOWN: usize = 0x0201;
        const WM_RBUTTONDOWN: usize = 0x0204;
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

        // Low-level keyboard hook info (KBDLLHOOKSTRUCT)
        #[repr(C)]
        struct KbdllHookStruct {
            vk_code: u32,
            scan_code: u32,
            flags: u32,
            time: u32,
            dw_extra_info: usize,
        }

        // Low-level mouse hook info (MSLLHOOKSTRUCT)
        #[repr(C)]
        struct MsllHookStruct {
            pt_x: i32,
            pt_y: i32,
            mouse_data: u32,
            flags: u32,
            time: u32,
            dw_extra_info: usize,
        }

        // MSG struct for the Windows message loop
        #[repr(C)]
        struct Msg {
            hwnd: HWND,
            message: u32,
            w_param: WPARAM,
            l_param: LPARAM,
            time: u32,
            pt_x: i32,
            pt_y: i32,
            l_private: u32,
        }

        #[link(name = "user32")]
        extern "system" {
            fn SetWindowsHookExW(
                id_hook: i32,
                lpfn: HOOKPROC,
                hmod: *mut c_void,
                dw_thread_id: u32,
            ) -> HHOOK;
            fn CallNextHookEx(hhk: HHOOK, n_code: i32, w_param: WPARAM, l_param: LPARAM)
                -> LRESULT;
            fn UnhookWindowsHookEx(hhk: HHOOK) -> i32;
            fn GetMessageW(
                lp_msg: *mut Msg,
                h_wnd: HWND,
                w_msg_filter_min: u32,
                w_msg_filter_max: u32,
            ) -> i32;
            fn TranslateMessage(lp_msg: *const Msg) -> i32;
            fn DispatchMessageW(lp_msg: *const Msg) -> LRESULT;
            fn GetForegroundWindow() -> HWND;
            fn GetWindowThreadProcessId(h_wnd: HWND, lpdw_process_id: *mut u32) -> u32;
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(
                dw_desired_access: u32,
                b_inherit_handle: i32,
                dw_process_id: u32,
            ) -> *mut c_void;
            fn QueryFullProcessImageNameW(
                h_process: *mut c_void,
                dw_flags: u32,
                lp_exe_name: *mut u16,
                lpdw_size: *mut u32,
            ) -> i32;
            fn CloseHandle(h_object: *mut c_void) -> i32;
        }

        // Get the exe stem (e.g. "Code") of the foreground window's process.
        unsafe fn foreground_app_name() -> String {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return "Unknown".to_string();
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return "Unknown".to_string();
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return "Unknown".to_string();
            }
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(handle);
            if ok == 0 || len == 0 {
                return "Unknown".to_string();
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string()
        }

        unsafe extern "system" fn keyboard_proc(
            code: i32,
            w_param: WPARAM,
            l_param: LPARAM,
        ) -> LRESULT {
            if code == HC_ACTION && (w_param == WM_KEYDOWN || w_param == WM_SYSKEYDOWN) {
                let _info = &*(l_param as *const KbdllHookStruct);
                if let Some(tx) = SENDER.get() {
                    let app = foreground_app_name();
                    let _ = tx.send(KeyEvent::KeyPress { app });
                }
            }
            CallNextHookEx(std::ptr::null_mut(), code, w_param, l_param)
        }

        unsafe extern "system" fn mouse_proc(
            code: i32,
            w_param: WPARAM,
            l_param: LPARAM,
        ) -> LRESULT {
            if code == HC_ACTION {
                let button = match w_param {
                    WM_LBUTTONDOWN => Some(0u8),
                    WM_RBUTTONDOWN => Some(1u8),
                    _ => None,
                };
                if let Some(btn) = button {
                    let _info = &*(l_param as *const MsllHookStruct);
                    if let Some(tx) = SENDER.get() {
                        let app = foreground_app_name();
                        let _ = tx.send(KeyEvent::MouseClick { app, button: btn });
                    }
                }
            }
            CallNextHookEx(std::ptr::null_mut(), code, w_param, l_param)
        }

        unsafe {
            let kb_hook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc, std::ptr::null_mut(), 0);
            let ms_hook = SetWindowsHookExW(WH_MOUSE_LL, mouse_proc, std::ptr::null_mut(), 0);

            if kb_hook.is_null() || ms_hook.is_null() {
                return;
            }

            let mut msg = Msg {
                hwnd: std::ptr::null_mut(),
                message: 0,
                w_param: 0,
                l_param: 0,
                time: 0,
                pt_x: 0,
                pt_y: 0,
                l_private: 0,
            };
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            UnhookWindowsHookEx(kb_hook);
            UnhookWindowsHookEx(ms_hook);
        }
    });
}
