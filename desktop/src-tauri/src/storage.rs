use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct StatsData {
    pub counts: HashMap<String, u64>,
    /// date → app_name → keystroke_count  (non-breaking: defaults to empty on old data)
    #[serde(default)]
    pub app_counts: HashMap<String, HashMap<String, u64>>,
}

struct StorageInner {
    data: Mutex<StatsData>,
    path: PathBuf,
}

#[derive(Clone)]
pub struct Storage(Arc<StorageInner>);

fn default_data_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("keli-keli").join("data.json")
}

impl Storage {
    pub fn load() -> Self {
        Self::load_from(default_data_path())
    }

    pub fn load_from(path: PathBuf) -> Self {
        let data = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| {
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                StatsData::default()
            });
        Storage(Arc::new(StorageInner {
            data: Mutex::new(data),
            path,
        }))
    }

    pub fn increment_today(&self) -> u64 {
        let today = today_key();
        let mut data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        let count = data.counts.entry(today).or_insert(0);
        *count += 1;
        *count
    }

    pub fn increment_today_app(&self, app: &str) {
        let today = today_key();
        let mut data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        *data
            .app_counts
            .entry(today)
            .or_default()
            .entry(app.to_string())
            .or_insert(0) += 1;
    }

    pub fn today_count(&self) -> u64 {
        let today = today_key();
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        *data.counts.get(&today).unwrap_or(&0)
    }

    pub fn get_stats(&self, days: usize) -> Vec<(String, u64)> {
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        let mut entries: Vec<_> = data.counts.iter().collect();
        entries.sort_by(|a, b| b.0.cmp(a.0));
        entries.truncate(days);
        entries.reverse();
        entries.into_iter().map(|(k, v)| (k.clone(), *v)).collect()
    }

    /// Returns (date, app_name, count) for the most recent `days` days, sorted by date desc then count desc.
    pub fn get_app_stats(&self, days: usize) -> Vec<(String, String, u64)> {
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        let mut dates: Vec<&String> = data.app_counts.keys().collect();
        dates.sort_by(|a, b| b.cmp(a));
        dates.truncate(days);
        let mut entries: Vec<(String, String, u64)> = dates
            .into_iter()
            .flat_map(|date| {
                data.app_counts[date]
                    .iter()
                    .map(|(app, count)| (date.clone(), app.clone(), *count))
            })
            .collect();
        entries.sort_by(|a, b| b.0.cmp(&a.0).then(b.2.cmp(&a.2)));
        entries
    }

    pub fn save(&self) {
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(json) = serde_json::to_string_pretty(&*data) {
            let _ = fs::write(&self.0.path, json);
        }
    }
}

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_storage() -> (TempDir, Storage) {
        let dir = TempDir::new().unwrap();
        let storage = Storage::load_from(dir.path().join("data.json"));
        (dir, storage)
    }

    #[test]
    fn increment_returns_monotonically_increasing_count() {
        let (_dir, s) = temp_storage();
        assert_eq!(s.increment_today(), 1);
        assert_eq!(s.increment_today(), 2);
        assert_eq!(s.increment_today(), 3);
    }

    #[test]
    fn today_count_starts_at_zero() {
        let (_dir, s) = temp_storage();
        assert_eq!(s.today_count(), 0);
    }

    #[test]
    fn save_and_reload_preserves_data() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        let s = Storage::load_from(path.clone());
        s.increment_today();
        s.increment_today();
        s.save();

        let s2 = Storage::load_from(path);
        assert_eq!(s2.today_count(), 2);
    }

    #[test]
    fn load_from_missing_file_starts_empty() {
        let dir = TempDir::new().unwrap();
        let s = Storage::load_from(dir.path().join("nonexistent.json"));
        assert_eq!(s.today_count(), 0);
    }

    #[test]
    fn get_stats_returns_dates_sorted_ascending() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        let mut counts = HashMap::new();
        counts.insert("2024-01-03".to_string(), 300u64);
        counts.insert("2024-01-01".to_string(), 100u64);
        counts.insert("2024-01-02".to_string(), 200u64);
        let json = serde_json::to_string_pretty(&StatsData {
                counts,
                ..Default::default()
            })
            .unwrap();
        fs::write(&path, json).unwrap();

        let s = Storage::load_from(path);
        let stats = s.get_stats(10);

        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].0, "2024-01-01");
        assert_eq!(stats[1].0, "2024-01-02");
        assert_eq!(stats[2].0, "2024-01-03");
    }

    #[test]
    fn get_stats_truncates_to_most_recent_n_days() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        let mut counts = HashMap::new();
        for i in 1u64..=10 {
            counts.insert(format!("2024-01-{i:02}"), i * 100);
        }
        let json = serde_json::to_string_pretty(&StatsData {
                counts,
                ..Default::default()
            })
            .unwrap();
        fs::write(&path, json).unwrap();

        let s = Storage::load_from(path);
        let stats = s.get_stats(5);

        assert_eq!(stats.len(), 5);
        // most recent 5: 06..10, sorted ascending
        assert_eq!(stats[0].0, "2024-01-06");
        assert_eq!(stats[4].0, "2024-01-10");
    }

    #[test]
    fn concurrent_increments_are_consistent() {
        use std::thread;

        let (_dir, s) = temp_storage();
        let handles: Vec<_> = (0..100)
            .map(|_| {
                let s = s.clone();
                thread::spawn(move || s.increment_today())
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(s.today_count(), 100);
    }

    // This test verifies that a poisoned Mutex does NOT cause a panic.
    // It will FAIL until the .unwrap() calls are replaced with
    // .unwrap_or_else(|e| e.into_inner()).
    #[test]
    fn poisoned_mutex_does_not_panic() {
        let (_dir, s) = temp_storage();
        let s2 = s.clone();

        // Poison the mutex by panicking while holding the lock
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = s2.0.data.lock().unwrap();
            panic!("intentional poison");
        }));

        // These should recover gracefully, not panic
        assert_eq!(s.today_count(), 0);
        assert_eq!(s.increment_today(), 1);
    }
}
