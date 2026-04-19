use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

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
pub struct IndicatorConfig {
    pub icon_type: String,  // "emoji" | "active_app"
    pub icon_value: String, // emoji string, used when icon_type = "emoji"
    pub badge_keystroke: String,
    pub badge_left_click: String,
    pub badge_right_click: String,
}

impl Default for IndicatorConfig {
    fn default() -> Self {
        IndicatorConfig {
            icon_type: "emoji".to_string(),
            icon_value: "⌨️".to_string(),
            badge_keystroke: "+1".to_string(),
            badge_left_click: "+1".to_string(),
            badge_right_click: "+1".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub flush_interval_secs: u64,
    /// Automatically install updates when one is found at launch.
    #[serde(default)]
    pub auto_update: bool,
    pub sync: SyncConfig,
    pub websocket: WebSocketConfig,
    #[serde(default)]
    pub indicator: IndicatorConfig,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            flush_interval_secs: 60,
            auto_update: false,
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
            indicator: IndicatorConfig::default(),
        }
    }
}

fn default_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("keli-keli")
        .join("config.toml")
}

pub fn save(cfg: &Config) {
    save_to(&default_config_path(), cfg);
}

pub fn save_to(path: &Path, cfg: &Config) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(content) = toml::to_string_pretty(cfg) {
        let _ = fs::write(path, content);
    }
}

pub fn load() -> Config {
    load_from(&default_config_path())
}

pub fn load_from(path: &Path) -> Config {
    if !path.exists() {
        let default = Config::default();
        save_to(path, &default);
        return default;
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| toml::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn config_path(dir: &TempDir) -> PathBuf {
        dir.path().join("config.toml")
    }

    #[test]
    fn default_config_has_sane_values() {
        let cfg = Config::default();
        assert_eq!(cfg.flush_interval_secs, 60);
        assert_eq!(cfg.sync.interval_secs, 60);
        assert_eq!(cfg.websocket.typing_idle_ms, 2000);
        assert!(!cfg.sync.enabled);
        assert!(!cfg.websocket.enabled);
    }

    #[test]
    fn save_and_load_round_trips() {
        let dir = TempDir::new().unwrap();
        let path = config_path(&dir);

        let mut cfg = Config::default();
        cfg.flush_interval_secs = 120;
        cfg.sync.enabled = true;
        cfg.sync.api_url = "https://example.com/api".to_string();
        cfg.sync.api_key = "secret-key".to_string();
        cfg.websocket.typing_idle_ms = 5000;

        save_to(&path, &cfg);
        let loaded = load_from(&path);

        assert_eq!(loaded.flush_interval_secs, 120);
        assert!(loaded.sync.enabled);
        assert_eq!(loaded.sync.api_url, "https://example.com/api");
        assert_eq!(loaded.sync.api_key, "secret-key");
        assert_eq!(loaded.websocket.typing_idle_ms, 5000);
    }

    #[test]
    fn load_from_missing_file_returns_default_and_creates_file() {
        let dir = TempDir::new().unwrap();
        let path = config_path(&dir);

        assert!(!path.exists());
        let cfg = load_from(&path);
        assert_eq!(cfg.flush_interval_secs, 60);
        // should have created the file
        assert!(path.exists());
    }

    #[test]
    fn load_from_corrupted_file_returns_default() {
        let dir = TempDir::new().unwrap();
        let path = config_path(&dir);
        fs::write(&path, b"not valid toml ][[[").unwrap();

        let cfg = load_from(&path);
        assert_eq!(cfg.flush_interval_secs, 60);
    }

    #[test]
    fn save_to_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a").join("b").join("config.toml");

        save_to(&path, &Config::default());
        assert!(path.exists());
    }
}
