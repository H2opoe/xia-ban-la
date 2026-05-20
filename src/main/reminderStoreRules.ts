import { OFF_WORK_REMINDER_ID } from '../shared/reminderConstants.js';
import { getReminderDueDateKey, toDateKey } from '../shared/reminderSchedule.js';
import type { AppSettings, Reminder, ReminderMessage } from '../shared/types.js';
import { createDefaultMessages, createId } from './defaults.js';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  lockScreenAfterIdle: false,
  selectedDisplayIds: [],
  themeMode: 'system'
};

export function getStoredDefaultMessages(messages: ReminderMessage[] | undefined, reminders: unknown[]) {
  const normalizedStoredMessages = normalizeMessages(Array.isArray(messages) ? messages : []);
  if (normalizedStoredMessages.length > 0) {
    return normalizedStoredMessages;
  }

  const existingOffWorkReminder = reminders.find((reminder): reminder is Reminder =>
    Boolean(reminder && typeof reminder === 'object' && 'id' in reminder && reminder.id === OFF_WORK_REMINDER_ID)
  );
  const migratedMessages = normalizeMessages(existingOffWorkReminder?.messages || []);
  return migratedMessages.length > 0 ? migratedMessages : createDefaultMessages();
}

export function normalizeAppSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    lockScreenAfterIdle: settings?.lockScreenAfterIdle === true,
    selectedDisplayIds: Array.isArray(settings?.selectedDisplayIds) ? settings.selectedDisplayIds : [],
    themeMode: normalizeThemeMode(settings?.themeMode)
  };
}

function normalizeThemeMode(themeMode: unknown) {
  return themeMode === 'light' || themeMode === 'dark' || themeMode === 'system'
    ? themeMode
    : DEFAULT_APP_SETTINGS.themeMode;
}

export function normalizeMessages(messages: ReminderMessage[]) {
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

export function migrateStoredReminder(reminder: Reminder): Reminder {
  const storedReminder = reminder as Reminder & {
    lastTriggeredDate?: unknown;
    alternateSaturdayMode?: 'work' | 'rest';
  };
  const {
    lastTriggeredDate: _lastTriggeredDate,
    alternateSaturdayMode,
    ...currentReminder
  } = storedReminder;

  if (currentReminder.repeatRule !== 'alternate-weeks' || !alternateSaturdayMode) {
    return currentReminder;
  }

  const baseDays = [1, 2, 3, 4, 5];
  const currentWeekWorks = alternateSaturdayMode === 'work';
  return {
    ...currentReminder,
    alternateWeekDays: currentReminder.alternateWeekDays || (currentWeekWorks ? [...baseDays, 6] : baseDays),
    alternateNextWeekDays: currentReminder.alternateNextWeekDays || (currentWeekWorks ? baseDays : [...baseDays, 6])
  };
}

export function normalizeStoredReminder(reminder: Reminder, primaryDisplayId: string, now = new Date()): Reminder {
  const todayKey = toDateKey(now);
  const todayOverrideTime = reminder.todayOverrideDate === todayKey ? reminder.todayOverrideTime : undefined;
  const completed = Boolean(reminder.completed);
  const normalizedReminder: Reminder = {
    ...reminder,
    name: reminder.name.trim(),
    createdAt: normalizeDateTime(reminder.createdAt) || getCreationTimeFromId(reminder.id),
    completed,
    completedAt: completed && isValidDateTime(reminder.completedAt) ? reminder.completedAt : undefined,
    repeatRule: normalizeRepeatRule(reminder.repeatRule),
    weeklyDays: normalizeWeeklyDays(reminder.weeklyDays),
    useAlternateWeeks: Boolean(reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks'),
    alternateWeekAnchorDate: normalizeAlternateWeekAnchorDate(reminder, todayKey),
    alternateWeekDays: normalizeAlternateWeekDays(reminder.alternateWeekDays),
    alternateNextWeekDays: normalizeAlternateWeekDays(reminder.alternateNextWeekDays),
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

export function shouldClearCompletedOnceReminder(reminder: Reminder, todayKey: string) {
  return Boolean(reminder.completed && getCompletedDateKey(reminder) !== todayKey);
}

export function shouldResetCompletedRepeatingReminder(reminder: Reminder, todayKey: string) {
  return Boolean(reminder.completed && getCompletedDateKey(reminder) !== todayKey);
}

export function shouldRestoreCompletedAfterFutureReschedule(existingReminder: Reminder, nextReminder: Reminder, now: Date) {
  // 已完成提醒只有在调度字段真的被改到未来触发点时才恢复，避免改文案或屏幕时重新唤起已收起的提醒。
  return Boolean(
    existingReminder.completed
    && nextReminder.completed
    && hasReminderScheduleChanged(existingReminder, nextReminder)
    && isReminderScheduledInFuture(nextReminder, now)
  );
}

export function clearCompletedState(reminder: Reminder): Reminder {
  return {
    ...reminder,
    completed: false,
    completedAt: undefined
  };
}

export function isOffWorkReminder(reminder: Reminder) {
  return reminder.id === OFF_WORK_REMINDER_ID || reminder.name.includes('下班');
}

export function clearTodayOverride(reminder: Reminder): Reminder {
  return {
    ...reminder,
    todayOverrideTime: undefined,
    todayOverrideDate: undefined
  };
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

function normalizeAlternateWeekDays(days: number[] | undefined) {
  if (days) {
    return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
  }
  return normalizeWeeklyDays();
}
