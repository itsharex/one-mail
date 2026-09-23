use std::{collections::HashSet, sync::Mutex};

#[derive(Default)]
pub struct SyncTracker {
    active: Mutex<HashSet<i64>>,
}

impl SyncTracker {
    pub fn start(&self, account_id: i64) -> Result<Option<SyncGuard<'_>>, String> {
        let mut active = self.active.lock().map_err(|_| "无法获取同步状态锁。")?;
        if !active.insert(account_id) {
            return Ok(None);
        }
        Ok(Some(SyncGuard {
            tracker: self,
            account_id,
        }))
    }

    pub fn account_ids(&self) -> Result<Vec<i64>, String> {
        let active = self.active.lock().map_err(|_| "无法获取同步状态锁。")?;
        let mut ids = active.iter().copied().collect::<Vec<_>>();
        ids.sort_unstable();
        Ok(ids)
    }
}

pub struct SyncGuard<'a> {
    tracker: &'a SyncTracker,
    account_id: i64,
}

impl Drop for SyncGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.tracker.active.lock() {
            active.remove(&self.account_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SyncTracker;

    #[test]
    fn tracks_active_accounts_and_releases_them_on_drop() {
        let tracker = SyncTracker::default();
        let first = tracker.start(2).unwrap().unwrap();
        let second = tracker.start(1).unwrap().unwrap();
        assert!(tracker.start(2).unwrap().is_none());
        assert_eq!(tracker.account_ids().unwrap(), vec![1, 2]);
        drop(first);
        drop(second);
        assert!(tracker.account_ids().unwrap().is_empty());
        assert!(tracker.start(2).unwrap().is_some());
    }
}
