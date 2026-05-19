import { app, screen } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getReminderDueDateKey,
  getReminderNextDateKey,
  isRepeatingReminder,
  toDateKey
} from '../shared/reminderSchedule.js';
import type { AppSettings, Reminder, ReminderMessage } from '../shared/types.js';
import { createDefaultExampleMoreReminders, createDefaultMessages, createId } from './defaults.js';

type StoreFile = {
  reminders: Reminder[];
  defaultMessages?: ReminderMessage[];
  settings?: Partial<AppSettings>;
  exampleMoreRemindersSeeded?: boolean;
  exampleRemindersSeeded?: boolean;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  lockScreenAfterIdle: false,
  selectedDisplayIds: []
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
      if (reminder.id !== 'default-off-work') {
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
        return this.ensureExampleMoreReminders(reminders.map((reminder) => this.normalizeReminder(reminder as Reminder)));
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
    const legacyReminder = reminder as Reminder & { lastTriggeredDate?: unknown };
    const {
      lastTriggeredDate: _legacyLastTriggeredDate,
      ...reminderWithoutLegacyState
    } = legacyReminder;
    const primaryDisplayId = this.getPrimaryDisplayId();
    const now = new Date();
    const todayKey = toDateKey(now);
    const todayOverrideTime = reminder.todayOverrideDate === todayKey ? reminder.todayOverrideTime : undefined;
    const completed = Boolean(reminder.completed);
    const normalizedReminder: Reminder = {
      ...reminderWithoutLegacyState,
      name: reminder.name.trim(),
      createdAt: normalizeDateTime(reminder.createdAt) || getCreationTimeFromId(reminder.id),
      completed,
      completedAt: completed && isValidDateTime(reminder.completedAt) ? reminder.completedAt : undefined,
      repeatRule: normalizeRepeatRule(reminder.repeatRule),
      weeklyDays: normalizeWeeklyDays(reminder.weeklyDays),
      useAlternateWeeks: Boolean(reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks'),
      alternateWeekAnchorDate: normalizeAlternateWeekAnchorDate(reminder, todayKey),
      alternateWeekDays: normalizeAlternateWeekDays(reminder.alternateWeekDays, getLegacyAlternateWeekDays(reminder, 'current')),
      alternateNextWeekDays: normalizeAlternateWeekDays(reminder.alternateNextWeekDays, getLegacyAlternateWeekDays(reminder, 'next')),
      scheduledDate: normalizeDateKey(reminder.scheduledDate) || todayKey,
      dailyTime: /^\d{2}:\d{2}$/.test(reminder.dailyTime) ? reminder.dailyTime : '18:00',
      todayOverrideTime,
      todayOverrideDate: todayOverrideTime ? todayKey : undefined,
      advanceMinutes: Math.max(0, Number(reminder.advanceMinutes) || 0),
      repeatIntervalMinutes: Math.max(1, Number(reminder.repeatIntervalMinutes) || 5),
      messages: reminder.messages.filter((message) => message.text.trim()).map((message) => ({
        ...message,
        text: message.text.trim()
      })),
      selectedDisplayIds: reminder.selectedDisplayIds.length > 0 ? reminder.selectedDisplayIds : [primaryDisplayId]
    };
    return {
      ...normalizedReminder,
      scheduledDate: getReminderDueDateKey(normalizedReminder, now)
    };
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

function getStoredDefaultMessages(messages: ReminderMessage[] | undefined, reminders: unknown[]) {
  const normalizedStoredMessages = normalizeMessages(Array.isArray(messages) ? messages : []);
  if (normalizedStoredMessages.length > 0) {
    return normalizedStoredMessages;
  }

  const existingOffWorkReminder = reminders.find((reminder): reminder is Reminder =>
    Boolean(reminder && typeof reminder === 'object' && 'id' in reminder && reminder.id === 'default-off-work')
  );
  const migratedMessages = normalizeMessages(existingOffWorkReminder?.messages || []);
  return migratedMessages.length > 0 ? migratedMessages : createDefaultMessages();
}

function normalizeAppSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    lockScreenAfterIdle: settings?.lockScreenAfterIdle === true,
    selectedDisplayIds: Array.isArray(settings?.selectedDisplayIds) ? settings.selectedDisplayIds : []
  };
}

function normalizeMessages(messages: ReminderMessage[]) {
  return messages
    .map((message) => {
      const source = message && typeof message === 'object' ? message : { id: '', text: '', enabled: true };
      return {
        id: typeof source.id === 'string' && source.id.trim() ? source.id : createId('message'),
        text: typeof source.text === 'string' ? source.text.trim() : '',
        enabled: source.enabled !== false
      };
    })
    .filter((message) => message.text);
}

function normalizeRepeatRule(rule: Reminder['repeatRule']): Reminder['repeatRule'] {
  return ['once', 'daily', 'weekdays', 'weekly', 'alternate-weeks'].includes(rule) ? rule : 'daily';
}

function normalizeDateKey(dateKey?: string) {
  return dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined;
}

function normalizeAlternateWeekAnchorDate(reminder: Reminder, todayKey: string) {
  if (!reminder.useAlternateWeeks && reminder.repeatRule !== 'alternate-weeks') {
    return normalizeDateKey(reminder.alternateWeekAnchorDate);
  }
  return normalizeDateKey(reminder.alternateWeekAnchorDate) || todayKey;
}

function normalizeDateTime(value?: string) {
  if (!value) {
    return undefined;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function getCreationTimeFromId(id: string) {
  const [, timestamp] = id.match(/^[^_]+_(\d+)_/) || [];
  if (!timestamp) {
    return undefined;
  }

  const time = Number(timestamp);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function isValidDateTime(value?: string) {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}

function shouldClearCompletedOnceReminder(reminder: Reminder, todayKey: string) {
  return Boolean(reminder.completed && getCompletedDateKey(reminder) !== todayKey);
}

function shouldResetCompletedRepeatingReminder(reminder: Reminder, todayKey: string) {
  return Boolean(reminder.completed && getCompletedDateKey(reminder) !== todayKey);
}

function shouldRestoreCompletedAfterFutureReschedule(existingReminder: Reminder, nextReminder: Reminder, now: Date) {
  // 已完成提醒只有在调度字段真的被改到未来触发点时才恢复，避免改文案或屏幕时重新唤起已收起的提醒。
  return Boolean(
    existingReminder.completed
    && nextReminder.completed
    && hasReminderScheduleChanged(existingReminder, nextReminder)
    && isReminderScheduledInFuture(nextReminder, now)
  );
}

function hasReminderScheduleChanged(first: Reminder, second: Reminder) {
  return (
    first.repeatRule !== second.repeatRule
    || first.scheduledDate !== second.scheduledDate
    || first.dailyTime !== second.dailyTime
    || first.todayOverrideTime !== second.todayOverrideTime
    || first.todayOverrideDate !== second.todayOverrideDate
    || first.advanceMinutes !== second.advanceMinutes
    || first.useAlternateWeeks !== second.useAlternateWeeks
    || first.alternateWeekAnchorDate !== second.alternateWeekAnchorDate
    || !areSameNumberLists(first.weeklyDays, second.weeklyDays)
    || !areSameNumberLists(first.alternateWeekDays, second.alternateWeekDays)
    || !areSameNumberLists(first.alternateNextWeekDays, second.alternateNextWeekDays)
  );
}

function isReminderScheduledInFuture(reminder: Reminder, now: Date) {
  const todayKey = toDateKey(now);
  if (reminder.scheduledDate > todayKey) {
    return true;
  }
  if (reminder.scheduledDate < todayKey || !shouldReminderRunToday(reminder, now, todayKey)) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return getReminderTargetMinutes(reminder, todayKey) > currentMinutes;
}

function shouldReminderRunToday(reminder: Reminder, now: Date, todayKey: string) {
  if (reminder.todayOverrideTime && reminder.todayOverrideDate === todayKey) {
    return true;
  }
  if (reminder.repeatRule === 'once') {
    return reminder.scheduledDate === todayKey;
  }
  return getReminderDueDateKey(reminder, now) === todayKey;
}

function getReminderTargetMinutes(reminder: Reminder, todayKey: string) {
  const time = reminder.todayOverrideTime && reminder.todayOverrideDate === todayKey
    ? reminder.todayOverrideTime
    : reminder.dailyTime;
  const [hour = 18, minute = 0] = time.split(':').map(Number);
  return Math.max(0, hour * 60 + minute - reminder.advanceMinutes);
}

function areSameNumberLists(first: number[] | undefined, second: number[] | undefined) {
  const normalizedFirst = first || [];
  const normalizedSecond = second || [];
  return normalizedFirst.length === normalizedSecond.length
    && normalizedFirst.every((value, index) => value === normalizedSecond[index]);
}

function clearCompletedState(reminder: Reminder): Reminder {
  return {
    ...reminder,
    completed: false,
    completedAt: undefined
  };
}

function getCompletedDateKey(reminder: Reminder) {
  const completedAt = reminder.completedAt ? new Date(reminder.completedAt) : null;
  if (!completedAt || Number.isNaN(completedAt.getTime())) {
    return undefined;
  }
  return toDateKey(completedAt);
}

function normalizeWeeklyDays(days?: number[]) {
  const normalizedDays = Array.from(new Set((days || []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
  return normalizedDays.length > 0 ? normalizedDays : [1, 2, 3, 4, 5];
}

function normalizeAlternateWeekDays(days: number[] | undefined, fallbackDays: number[] | undefined) {
  if (days) {
    return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
  }
  return normalizeWeeklyDays(fallbackDays);
}

function getLegacyAlternateWeekDays(reminder: Reminder, week: 'current' | 'next') {
  if (reminder.repeatRule !== 'alternate-weeks') {
    return undefined;
  }

  const baseDays = [1, 2, 3, 4, 5];
  const legacyMode = (reminder as Reminder & { alternateSaturdayMode?: 'work' | 'rest' }).alternateSaturdayMode;
  const currentWeekWorks = legacyMode === 'work';
  const includeSaturday = week === 'current' ? currentWeekWorks : !currentWeekWorks;
  return includeSaturday ? [...baseDays, 6] : baseDays;
}

function isOffWorkReminder(reminder: Reminder) {
  return reminder.id === 'default-off-work' || reminder.name.includes('下班');
}

function clearTodayOverride(reminder: Reminder): Reminder {
  return {
    ...reminder,
    todayOverrideTime: undefined,
    todayOverrideDate: undefined
  };
}
