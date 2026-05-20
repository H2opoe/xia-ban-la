import { app, screen } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getReminderNextDateKey,
  isRepeatingReminder,
  toDateKey
} from '../shared/reminderSchedule.js';
import { OFF_WORK_REMINDER_ID } from '../shared/reminderConstants.js';
import type { AppSettings, Reminder, ReminderMessage } from '../shared/types.js';
import { createDefaultExampleMoreReminders, createDefaultMessages } from './defaults.js';
import {
  clearCompletedState,
  clearTodayOverride,
  DEFAULT_APP_SETTINGS,
  getStoredDefaultMessages,
  isOffWorkReminder,
  migrateStoredReminder,
  normalizeAppSettings,
  normalizeMessages,
  normalizeStoredReminder,
  shouldClearCompletedOnceReminder,
  shouldResetCompletedRepeatingReminder,
  shouldRestoreCompletedAfterFutureReschedule
} from './reminderStoreRules.js';

type StoreFile = {
  reminders: Reminder[];
  defaultMessages?: ReminderMessage[];
  settings?: Partial<AppSettings>;
  exampleMoreRemindersSeeded?: boolean;
  exampleRemindersSeeded?: boolean;
};

export class ReminderStore {
  private filePath = '';
  private reminders: Reminder[] = [];
  private defaultMessages: ReminderMessage[] = createDefaultMessages();
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  private exampleMoreRemindersSeeded = false;
  private listeners = new Set<(reminders: Reminder[]) => void>();

  async init() {
    const userDataPath = app.getPath('userData');
    this.filePath = join(userDataPath, 'reminders.json');
    await mkdir(userDataPath, { recursive: true });
    this.reminders = await this.loadFromDisk();
    this.resetCompletedRemindersAfterMidnight(new Date());
    await this.saveToDisk();
  }

  getAll() {
    return this.reminders;
  }

  getDefaultMessages() {
    return this.defaultMessages.map((message) => ({ ...message }));
  }

  getAppSettings() {
    return {
      ...this.settings,
      selectedDisplayIds: this.normalizeSelectedDisplayIds(this.settings.selectedDisplayIds)
    };
  }

  subscribe(listener: (reminders: Reminder[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async save(reminder: Reminder) {
    let normalizedReminder = this.normalizeReminder(reminder);
    const existingIndex = this.reminders.findIndex((item) => item.id === reminder.id);
    if (existingIndex >= 0) {
      const existingReminder = this.reminders[existingIndex];
      if (isOffWorkReminder(normalizedReminder) && existingReminder.dailyTime !== normalizedReminder.dailyTime) {
        normalizedReminder = clearTodayOverride(normalizedReminder);
      }
      if (shouldRestoreCompletedAfterFutureReschedule(existingReminder, normalizedReminder, new Date())) {
        normalizedReminder = clearCompletedState(normalizedReminder);
      }
      this.reminders[existingIndex] = normalizedReminder;
    } else {
      this.reminders.unshift(normalizedReminder);
    }
    await this.saveToDisk();
    return normalizedReminder;
  }

  async delete(id: string) {
    this.reminders = this.reminders.filter((item) => item.id !== id);
    await this.saveToDisk();
  }

  async toggle(id: string, enabled: boolean) {
    const reminder = this.reminders.find((item) => item.id === id);
    if (!reminder) {
      throw new Error('提醒不存在');
    }
    reminder.enabled = enabled;
    await this.saveToDisk();
  }

  async markCompleted(id: string) {
    const reminder = this.reminders.find((item) => item.id === id);
    if (!reminder) {
      throw new Error('提醒不存在');
    }
    reminder.completed = true;
    reminder.completedAt = new Date().toISOString();
    await this.saveToDisk();
  }

  async markCompletedOnDismiss(id: string) {
    const reminder = this.reminders.find((item) => item.id === id);
    if (!reminder) {
      throw new Error('提醒不存在');
    }

    // 关闭提醒浮层代表今天已经处理过；下班提醒也需要记录，否则到点后会被调度器反复唤起。
    reminder.completed = true;
    reminder.completedAt = new Date().toISOString();
    await this.saveToDisk();
    return true;
  }

  async reconcileForToday(now = new Date()) {
    if (!this.resetCompletedRemindersAfterMidnight(now)) {
      return;
    }
    await this.saveToDisk();
  }

  async updateAll(reminders: Reminder[]) {
    this.reminders = reminders.map((reminder) => this.normalizeReminder(reminder));
    this.resetCompletedRemindersAfterMidnight(new Date());
    await this.saveToDisk();
  }

  async saveDefaultMessages(messages: ReminderMessage[]) {
    const normalizedMessages = normalizeMessages(messages);
    if (normalizedMessages.length === 0) {
      throw new Error('至少保留一条提醒文案');
    }

    this.defaultMessages = normalizedMessages;
    this.reminders = this.reminders.map((reminder) => {
      if (reminder.id !== OFF_WORK_REMINDER_ID) {
        return reminder;
      }

      return this.normalizeReminder({
        ...reminder,
        messages: normalizedMessages.map((message) => ({ ...message }))
      });
    });
    await this.saveToDisk();
    return this.getDefaultMessages();
  }

  async resetDefaultMessages() {
    return this.saveDefaultMessages(createDefaultMessages());
  }

  async setLockScreenAfterIdle(enabled: boolean) {
    this.settings = {
      ...this.settings,
      lockScreenAfterIdle: enabled
    };
    await this.saveToDisk();
    return this.getAppSettings();
  }

  async setSelectedDisplayIds(displayIds: string[]) {
    this.settings = {
      ...this.settings,
      selectedDisplayIds: this.normalizeSelectedDisplayIds(displayIds)
    };
    await this.saveToDisk();
    return this.getAppSettings();
  }

  private async loadFromDisk() {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as Partial<StoreFile>;
      const reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
      this.defaultMessages = getStoredDefaultMessages(parsed.defaultMessages, reminders);
      this.settings = normalizeAppSettings(parsed.settings);
      if (reminders.length > 0) {
        this.exampleMoreRemindersSeeded = Boolean(parsed.exampleMoreRemindersSeeded ?? parsed.exampleRemindersSeeded);
        return this.ensureExampleMoreReminders(reminders.map((reminder) => this.normalizeReminder(migrateStoredReminder(reminder as Reminder))));
      }
    } catch {
      // 配置不存在或损坏时仍创建基础数据；下班提醒必须由用户首次手动设置。
    }

    this.exampleMoreRemindersSeeded = true;
    return createDefaultExampleMoreReminders(this.getPrimaryDisplayId())
      .map((reminder) => this.normalizeReminder(reminder));
  }

  private async saveToDisk() {
    const payload: StoreFile = {
      reminders: this.reminders,
      defaultMessages: this.defaultMessages,
      settings: this.settings,
      exampleMoreRemindersSeeded: this.exampleMoreRemindersSeeded
    };
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.reminders);
    }
  }

  private normalizeReminder(reminder: Reminder): Reminder {
    return normalizeStoredReminder(reminder, this.getPrimaryDisplayId());
  }

  private getPrimaryDisplayId() {
    return String(screen.getPrimaryDisplay().id);
  }

  private normalizeSelectedDisplayIds(displayIds: string[]) {
    const validDisplayIds = new Set(screen.getAllDisplays().map((display) => String(display.id)));
    const selectedDisplayIds = Array.from(new Set(displayIds.filter((displayId) => validDisplayIds.has(displayId))));
    return selectedDisplayIds.length > 0 ? selectedDisplayIds : [this.getPrimaryDisplayId()];
  }

  private ensureExampleMoreReminders(reminders: Reminder[]) {
    if (this.exampleMoreRemindersSeeded) {
      return reminders;
    }

    const existingIds = new Set(reminders.map((reminder) => reminder.id));
    const examples = createDefaultExampleMoreReminders(this.getPrimaryDisplayId())
      .filter((reminder) => !existingIds.has(reminder.id))
      .map((reminder) => this.normalizeReminder(reminder));
    this.exampleMoreRemindersSeeded = true;
    return [...reminders, ...examples];
  }

  private resetCompletedRemindersAfterMidnight(now: Date) {
    const todayKey = toDateKey(now);
    let changed = false;
    const nextReminders: Reminder[] = [];

    for (const reminder of this.reminders) {
      if (!isRepeatingReminder(reminder)) {
        if (reminder.linkedExternalSource?.isRecurring) {
          // 本机重复日程和提醒事项的下一次日期由系统同步回来；完成当前实例后不能按一次性提醒清掉绑定。
          nextReminders.push(reminder);
          continue;
        }
        if (shouldClearCompletedOnceReminder(reminder, todayKey)) {
          changed = true;
          continue;
        }
        nextReminders.push(reminder);
        continue;
      }

      const shouldResetCompleted = shouldResetCompletedRepeatingReminder(reminder, todayKey);
      if (!shouldResetCompleted) {
        nextReminders.push(reminder);
        continue;
      }

      const nextDateKey = getReminderNextDateKey(reminder, now);
      const nextReminder: Reminder = {
        ...reminder,
        scheduledDate: nextDateKey,
        completed: false,
        completedAt: undefined
      };

      if (
        nextReminder.scheduledDate !== reminder.scheduledDate
        || nextReminder.completed !== reminder.completed
        || nextReminder.completedAt !== reminder.completedAt
      ) {
        changed = true;
      }

      nextReminders.push(nextReminder);
    }

    if (changed) {
      // 跨过 0 点后，一次性已完成事项从数据里清掉；重复事项恢复为未完成并推进到下一次日期。
      this.reminders = nextReminders;
    }

    return changed;
  }
}
