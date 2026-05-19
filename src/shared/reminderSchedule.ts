import type { Reminder } from './types.js';

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isRepeatingReminder(reminder: Reminder) {
  return reminder.repeatRule !== 'once';
}

export function getReminderDueDateKey(reminder: Reminder, fromDate = new Date()) {
  if (!isRepeatingReminder(reminder)) {
    return reminder.scheduledDate;
  }

  const fromDateKey = toDateKey(fromDate);
  return reminder.scheduledDate && reminder.scheduledDate >= fromDateKey
    ? reminder.scheduledDate
    : getReminderNextDateKey(reminder, fromDate);
}

export function getReminderNextDateKey(reminder: Reminder, fromDate = new Date()) {
  for (let offset = 0; offset < 366; offset += 1) {
    const candidateDate = new Date(fromDate);
    candidateDate.setDate(fromDate.getDate() + offset);
    const candidateKey = toDateKey(candidateDate);
    if (shouldReminderRunOnDate(reminder, candidateDate, candidateKey)) {
      return candidateKey;
    }
  }

  return toDateKey(fromDate);
}

export function getReminderNextTriggerDateKey(reminder: Reminder, fromDate = new Date()) {
  if (!isRepeatingReminder(reminder)) {
    return reminder.scheduledDate;
  }

  const fromDateKey = toDateKey(fromDate);
  const currentMinutes = fromDate.getHours() * 60 + fromDate.getMinutes();
  const targetMinutes = getReminderTargetMinutes(reminder, fromDateKey);

  for (let offset = 0; offset < 366; offset += 1) {
    const candidateDate = new Date(fromDate);
    candidateDate.setDate(fromDate.getDate() + offset);
    const candidateKey = toDateKey(candidateDate);
    if (!shouldReminderRunOnDate(reminder, candidateDate, candidateKey)) {
      continue;
    }

    // 今天已经过了提醒点时，新建默认数据应落到下一次真实触发日，而不是停在今天。
    if (candidateKey === fromDateKey && currentMinutes >= targetMinutes) {
      continue;
    }

    return candidateKey;
  }

  return fromDateKey;
}

export function shouldReminderRunOnDate(reminder: Reminder, date: Date, dateKey = toDateKey(date)) {
  if (reminder.repeatRule === 'once') {
    return reminder.scheduledDate === dateKey;
  }
  // 重复提醒的 scheduledDate 表示下一次明确触发日期；到这天之后再回到原重复规则。
  if (reminder.scheduledDate === dateKey) {
    return true;
  }
  if (reminder.scheduledDate && dateKey < reminder.scheduledDate) {
    return false;
  }
  if (reminder.repeatRule === 'daily') {
    return true;
  }
  if (reminder.repeatRule === 'weekdays') {
    const day = date.getDay();
    return day >= 1 && day <= 5;
  }
  if (reminder.repeatRule === 'alternate-weeks') {
    return getAlternateWeekDays(reminder, date).includes(date.getDay());
  }
  if (reminder.useAlternateWeeks) {
    return getAlternateWeekDays(reminder, date).includes(date.getDay());
  }
  return reminder.weeklyDays?.includes(date.getDay()) ?? false;
}

function getReminderTargetMinutes(reminder: Reminder, dateKey: string) {
  const time = reminder.todayOverrideTime && reminder.todayOverrideDate === dateKey
    ? reminder.todayOverrideTime
    : reminder.dailyTime;
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return Math.max(0, hour * 60 + minute - reminder.advanceMinutes);
}

export function getAlternateWeekDays(reminder: Reminder, date: Date) {
  return getAlternateWeekCycleSlot(reminder, date) === 'anchor'
    ? reminder.alternateWeekDays ?? [1, 2, 3, 4, 5]
    : reminder.alternateNextWeekDays ?? [1, 2, 3, 4, 5];
}

export function getAlternateWeekCycleSlot(reminder: Reminder, date: Date): 'anchor' | 'next' {
  return getWeekOffsetFromAnchor(reminder, date) % 2 === 0 ? 'anchor' : 'next';
}

function getWeekOffsetFromAnchor(reminder: Reminder, date: Date) {
  const anchorDate = getAlternateWeekAnchorDate(reminder);
  const anchorWeekStart = getMondayWeekStart(anchorDate);
  const targetWeekStart = getMondayWeekStart(date);
  return Math.floor((targetWeekStart.getTime() - anchorWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function getAlternateWeekAnchorDate(reminder: Reminder) {
  return parseDateKey(reminder.alternateWeekAnchorDate)
    ?? parseDateKey(reminder.scheduledDate)
    ?? parseDateTime(reminder.createdAt)
    ?? new Date();
}

function getMondayWeekStart(date: Date) {
  const weekStart = new Date(date);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  return weekStart;
}

function parseDateKey(dateKey?: string) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return undefined;
  }
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDateTime(value?: string) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
