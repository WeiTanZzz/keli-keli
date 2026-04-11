use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct StatsData {
    pub counts: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct Storage(Arc<Mutex<StatsData>>);

fn data_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("keli-keli").join("data.json")
}

impl Storage {
    pub fn load() -> Self {
        let path = data_path();
        let data = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            StatsData::default()
        };
        Storage(Arc::new(Mutex::new(data)))
    }

    pub fn increment_today(&self) -> u64 {
        let today = today_key();
        let mut data = self.0.lock().unwrap();
        let count = data.counts.entry(today).or_insert(0);
        *count += 1;
        *count
    }

    pub fn today_count(&self) -> u64 {
        let today = today_key();
        let data = self.0.lock().unwrap();
        *data.counts.get(&today).unwrap_or(&0)
    }

    pub fn get_stats(&self, days: usize) -> Vec<(String, u64)> {
        let data = self.0.lock().unwrap();
        let mut entries: Vec<(String, u64)> = data.counts.clone().into_iter().collect();
        entries.sort_by(|a, b| b.0.cmp(&a.0));
        entries.truncate(days);
        entries.reverse();
        entries
    }

    pub fn save(&self) {
        let path = data_path();
        let data = self.0.lock().unwrap();
        if let Ok(json) = serde_json::to_string_pretty(&*data) {
            let _ = fs::write(&path, json);
        }
    }
}

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}
