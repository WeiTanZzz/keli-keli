use std::sync::OnceLock;
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
    /// Cmd+Q intercepted while KeliKeli is active — macOS only.
    CmdQ,
}

pub(crate) static SENDER: OnceLock<mpsc::UnboundedSender<KeyEvent>> = OnceLock::new();

pub fn start(tx: mpsc::UnboundedSender<KeyEvent>) {
    let _ = SENDER.set(tx);
    #[cfg(target_os = "macos")]
    macos::start();
    #[cfg(target_os = "windows")]
    windows::start();
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
