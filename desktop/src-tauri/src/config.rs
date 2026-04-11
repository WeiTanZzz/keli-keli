use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub interval_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketConfig {
    pub enabled: bool,
    pub ws_url: String,
    pub typing_idle_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub flush_interval_secs: u64,
    pub sync: SyncConfig,
    pub websocket: WebSocketConfig,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            flush_interval_secs: 60,
            sync: SyncConfig {
                enabled: false,
                api_url: String::new(),
                api_key: String::new(),
                interval_secs: 60,
            },
            websocket: WebSocketConfig {
                enabled: false,
                ws_url: String::new(),
                typing_idle_ms: 2000,
            },
        }
    }
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("keli-keli")
        .join("config.toml")
}

pub fn save(cfg: &Config) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = toml::to_string_pretty(cfg) {
        let _ = fs::write(&path, content);
    }
}

pub fn load() -> Config {
    let path = config_path();
    if !path.exists() {
        let default = Config::default();
        save(&default);
        return default;
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| toml::from_str(&s).ok())
        .unwrap_or_default()
}
