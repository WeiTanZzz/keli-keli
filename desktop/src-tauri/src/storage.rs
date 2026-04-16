use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct StatsData {
    pub counts: HashMap<String, u64>,
    /// date → app_name → keystroke_count
    #[serde(default)]
    pub app_counts: HashMap<String, HashMap<String, u64>>,
    /// date → app_name → left_click_count
    #[serde(default)]
    pub app_left_click_counts: HashMap<String, HashMap<String, u64>>,
    /// date → app_name → right_click_count
    #[serde(default)]
    pub app_right_click_counts: HashMap<String, HashMap<String, u64>>,
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

    /// button: 0 = left, 1 = right, anything else is ignored
    pub fn increment_today_app_click(&self, app: &str, button: u8) {
        let today = today_key();
        let mut data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        let map = match button {
            0 => &mut data.app_left_click_counts,
            1 => &mut data.app_right_click_counts,
            _ => return,
        };
        *map.entry(today)
            .or_default()
            .entry(app.to_string())
            .or_insert(0) += 1;
    }

    /// Returns (date, app, left_clicks, right_clicks) for the most recent `days` days.
    pub fn get_app_click_stats(&self, days: usize) -> Vec<(String, String, u64, u64)> {
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        // Collect all (date, app) pairs that appear in either map
        let mut keys: HashSet<(String, String)> = HashSet::new();
        for (date, apps) in &data.app_left_click_counts {
            for app in apps.keys() {
                keys.insert((date.clone(), app.clone()));
            }
        }
        for (date, apps) in &data.app_right_click_counts {
            for app in apps.keys() {
                keys.insert((date.clone(), app.clone()));
            }
        }
        // Limit to the most recent `days` distinct dates
        let mut all_dates: Vec<String> = keys.iter().map(|(d, _)| d.clone()).collect();
        all_dates.sort_by(|a, b| b.cmp(a));
        all_dates.dedup();
        all_dates.truncate(days);
        let cutoff = all_dates.last().cloned().unwrap_or_default();

        let mut entries: Vec<(String, String, u64, u64)> = keys
            .into_iter()
            .filter(|(date, _)| date.as_str() >= cutoff.as_str())
            .map(|(date, app)| {
                let left = data
                    .app_left_click_counts
                    .get(&date)
                    .and_then(|m| m.get(&app))
                    .copied()
                    .unwrap_or(0);
                let right = data
                    .app_right_click_counts
                    .get(&date)
                    .and_then(|m| m.get(&app))
                    .copied()
                    .unwrap_or(0);
                (date, app, left, right)
            })
            .collect();
        entries.sort_by(|a, b| b.0.cmp(&a.0).then((b.2 + b.3).cmp(&(a.2 + a.3))));
        entries
    }

    pub fn today_count(&self) -> u64 {
        let today = today_key();
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        *data.counts.get(&today).unwrap_or(&0)
    }

    /// Returns (left_clicks, right_clicks) totals across all apps for today.
    pub fn today_click_counts(&self) -> (u64, u64) {
        let today = today_key();
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        let left = data
            .app_left_click_counts
            .get(&today)
            .map(|m| m.values().sum())
            .unwrap_or(0);
        let right = data
            .app_right_click_counts
            .get(&today)
            .map(|m| m.values().sum())
            .unwrap_or(0);
        (left, right)
    }

    /// Returns (keystrokes, left_clicks, right_clicks) summed across all time.
    pub fn all_time_counts(&self) -> (u64, u64, u64) {
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        let keystrokes = data.counts.values().sum();
        let left = data
            .app_left_click_counts
            .values()
            .flat_map(|m| m.values())
            .sum();
        let right = data
            .app_right_click_counts
            .values()
            .flat_map(|m| m.values())
            .sum();
        (keystrokes, left, right)
    }

    /// Returns (date, keystrokes, left_clicks, right_clicks) for the most recent `days` days,
    /// sorted ascending by date.
    pub fn get_daily_stats(&self, days: usize) -> Vec<(String, u64, u64, u64)> {
        let data = self.0.data.lock().unwrap_or_else(|e| e.into_inner());
        // Collect all dates that appear in any of the three maps
        let mut all_dates: HashSet<&String> = HashSet::new();
        all_dates.extend(data.counts.keys());
        all_dates.extend(data.app_left_click_counts.keys());
        all_dates.extend(data.app_right_click_counts.keys());
        let mut dates: Vec<&String> = all_dates.into_iter().collect();
        dates.sort_by(|a, b| b.cmp(a));
        dates.truncate(days);
        let mut entries: Vec<(String, u64, u64, u64)> = dates
            .into_iter()
            .map(|date| {
                let keystrokes = data.counts.get(date).copied().unwrap_or(0);
                let left = data
                    .app_left_click_counts
                    .get(date)
                    .map(|m| m.values().sum())
                    .unwrap_or(0);
                let right = data
                    .app_right_click_counts
                    .get(date)
                    .map(|m| m.values().sum())
                    .unwrap_or(0);
                (date.clone(), keystrokes, left, right)
            })
            .collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        entries
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

    #[test]
    fn mouse_clicks_tracked_separately_from_keystrokes() {
        let (_dir, s) = temp_storage();
        s.increment_today_app("Safari");
        s.increment_today_app("Safari");
        s.increment_today_app_click("Safari", 0); // left click

        let key_stats = s.get_app_stats(7);
        let click_stats = s.get_app_click_stats(7);

        let key_count = key_stats
            .iter()
            .find(|(_, a, _)| a == "Safari")
            .map(|(_, _, c)| *c)
            .unwrap();
        let (left, right) = click_stats
            .iter()
            .find(|(_, a, _, _)| a == "Safari")
            .map(|(_, _, l, r)| (*l, *r))
            .unwrap();
        assert_eq!(key_count, 2);
        assert_eq!(left, 1);
        assert_eq!(right, 0);
    }

    #[test]
    fn left_and_right_clicks_tracked_independently() {
        let (_dir, s) = temp_storage();
        s.increment_today_app_click("Finder", 0); // left
        s.increment_today_app_click("Finder", 0); // left
        s.increment_today_app_click("Finder", 1); // right

        let click_stats = s.get_app_click_stats(7);
        let (left, right) = click_stats
            .iter()
            .find(|(_, a, _, _)| a == "Finder")
            .map(|(_, _, l, r)| (*l, *r))
            .unwrap();
        assert_eq!(left, 2);
        assert_eq!(right, 1);
    }

    #[test]
    fn mouse_clicks_persist_across_reload() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        let s = Storage::load_from(path.clone());
        s.increment_today_app_click("Finder", 0);
        s.increment_today_app_click("Finder", 1);
        s.save();

        let s2 = Storage::load_from(path);
        let click_stats = s2.get_app_click_stats(7);
        let (left, right) = click_stats
            .iter()
            .find(|(_, a, _, _)| a == "Finder")
            .map(|(_, _, l, r)| (*l, *r))
            .unwrap();
        assert_eq!(left, 1);
        assert_eq!(right, 1);
    }

    #[test]
    fn middle_and_unknown_button_clicks_are_ignored() {
        let (_dir, s) = temp_storage();
        s.increment_today_app_click("Safari", 2); // middle — should be ignored
        s.increment_today_app_click("Safari", 99); // unknown — should be ignored

        let click_stats = s.get_app_click_stats(7);
        assert!(
            click_stats.is_empty(),
            "buttons other than 0/1 should not be recorded"
        );
    }

    #[test]
    fn get_app_click_stats_truncates_to_most_recent_n_days() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        // Manually build app_left_click_counts across 5 dates
        let mut left: HashMap<String, HashMap<String, u64>> = HashMap::new();
        for i in 1u64..=5 {
            let mut apps = HashMap::new();
            apps.insert("Chrome".to_string(), i * 10);
            left.insert(format!("2024-01-{i:02}"), apps);
        }
        let json = serde_json::to_string_pretty(&StatsData {
            app_left_click_counts: left,
            ..Default::default()
        })
        .unwrap();
        fs::write(&path, json).unwrap();

        let s = Storage::load_from(path);
        // Request only 3 most-recent days (01-03, 01-04, 01-05)
        let stats = s.get_app_click_stats(3);
        let dates: Vec<_> = stats.iter().map(|(d, _, _, _)| d.as_str()).collect();
        assert!(
            dates.iter().all(|d| *d >= "2024-01-03"),
            "only the 3 most recent dates should appear, got: {dates:?}"
        );
        assert_eq!(stats.len(), 3, "expected 3 entries, got {}", stats.len());
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

    #[test]
    fn all_time_counts_sums_all_days() {
        let (_dir, s) = temp_storage();
        s.increment_today();
        s.increment_today();
        s.increment_today_app_click("Safari", 0);
        s.increment_today_app_click("Finder", 1);
        let (ks, left, right) = s.all_time_counts();
        assert_eq!(ks, 2);
        assert_eq!(left, 1);
        assert_eq!(right, 1);
    }

    #[test]
    fn today_click_counts_sums_across_all_apps() {
        let (_dir, s) = temp_storage();
        s.increment_today_app_click("Safari", 0);
        s.increment_today_app_click("Finder", 0);
        s.increment_today_app_click("Finder", 1);
        let (left, right) = s.today_click_counts();
        assert_eq!(left, 2);
        assert_eq!(right, 1);
    }

    #[test]
    fn today_click_counts_starts_at_zero() {
        let (_dir, s) = temp_storage();
        assert_eq!(s.today_click_counts(), (0, 0));
    }

    #[test]
    fn get_daily_stats_combines_all_three_data_types() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        let mut counts = HashMap::new();
        counts.insert("2024-01-01".to_string(), 100u64);
        let mut left: HashMap<String, HashMap<String, u64>> = HashMap::new();
        let mut day_left = HashMap::new();
        day_left.insert("Safari".to_string(), 5u64);
        left.insert("2024-01-01".to_string(), day_left);
        let mut right: HashMap<String, HashMap<String, u64>> = HashMap::new();
        let mut day_right = HashMap::new();
        day_right.insert("Finder".to_string(), 3u64);
        right.insert("2024-01-01".to_string(), day_right);

        let json = serde_json::to_string_pretty(&StatsData {
            counts,
            app_left_click_counts: left,
            app_right_click_counts: right,
            ..Default::default()
        })
        .unwrap();
        fs::write(&path, json).unwrap();

        let s = Storage::load_from(path);
        let stats = s.get_daily_stats(7);
        assert_eq!(stats.len(), 1);
        let (date, keystrokes, left_clicks, right_clicks) = &stats[0];
        assert_eq!(date, "2024-01-01");
        assert_eq!(*keystrokes, 100);
        assert_eq!(*left_clicks, 5);
        assert_eq!(*right_clicks, 3);
    }

    #[test]
    fn get_daily_stats_truncates_to_most_recent_n_days() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data.json");

        let mut counts = HashMap::new();
        for i in 1u64..=10 {
            counts.insert(format!("2024-01-{i:02}"), i * 10);
        }
        let json = serde_json::to_string_pretty(&StatsData {
            counts,
            ..Default::default()
        })
        .unwrap();
        fs::write(&path, json).unwrap();

        let s = Storage::load_from(path);
        let stats = s.get_daily_stats(3);
        assert_eq!(stats.len(), 3);
        assert_eq!(stats[0].0, "2024-01-08");
        assert_eq!(stats[2].0, "2024-01-10");
    }
}
