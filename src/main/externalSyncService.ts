import type { SyncResult } from '../shared/types.js';
import { syncExternalSources } from './externalSources.js';
import type { ReminderStore } from './store.js';

const EXTERNAL_SYNC_INTERVAL_MS = 30_000;

export class ExternalSyncService {
  private timer: NodeJS.Timeout | null = null;
  private currentSync: Promise<SyncResult> | null = null;

  constructor(private readonly store: ReminderStore) {}

  start() {
    this.stop();
    void this.syncNow();
    this.timer = setInterval(() => {
      void this.syncNow();
    }, EXTERNAL_SYNC_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  syncNow() {
    if (this.currentSync) {
      return this.currentSync;
    }

    this.currentSync = this.runSync().finally(() => {
      this.currentSync = null;
    });
    return this.currentSync;
  }

  private async runSync(): Promise<SyncResult> {
    const currentReminders = this.store.getAll();
    if (!currentReminders.some((reminder) => reminder.linkedExternalSource)) {
      return {
        ok: true,
        syncedCount: 0,
        message: '没有需要同步的外部提醒'
      };
    }

    const { reminders, result } = await syncExternalSources(currentReminders);
    if (haveRemindersChanged(currentReminders, reminders)) {
      await this.store.updateAll(reminders);
    }
    return result;
  }
}

function haveRemindersChanged(previousReminders: unknown[], nextReminders: unknown[]) {
  return JSON.stringify(normalizeForComparison(previousReminders)) !== JSON.stringify(normalizeForComparison(nextReminders));
}

function normalizeForComparison(reminders: unknown[]) {
  return reminders.map((reminder) => {
    if (!reminder || typeof reminder !== 'object' || !('linkedExternalSource' in reminder)) {
      return reminder;
    }

    const currentReminder = reminder as Record<string, unknown>;
    const linkedExternalSource = currentReminder.linkedExternalSource;
    if (!linkedExternalSource || typeof linkedExternalSource !== 'object') {
      return reminder;
    }

    // lastSyncedAt 只是同步流水时间，不能因为它变化就反复写磁盘和刷新列表。
    const { lastSyncedAt: _lastSyncedAt, ...stableLinkedExternalSource } = linkedExternalSource as Record<string, unknown>;
    return {
      ...currentReminder,
      linkedExternalSource: stableLinkedExternalSource
    };
  });
}
