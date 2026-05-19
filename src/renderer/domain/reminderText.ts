import { DEFAULT_WORK_WEEK_DAYS, OFF_WORK_REMINDER_ID, WEEK_DAYS } from '../../shared/reminderConstants';
import { getAlternateWeekDays, getReminderDueDateKey, shouldReminderRunOnDate, toDateKey } from '../../shared/reminderSchedule';
import type { Reminder } from '../../shared/types';
import { formatDateKey } from './dateTimeInput';

export type OffWorkCountdownState = {
  text: string;
  showTimeMeta: boolean;
};

export function findOffWorkReminder(reminders: Reminder[]) {
  return reminders.find((reminder) => reminder.id === OFF_WORK_REMINDER_ID)
    || reminders.find((reminder) => reminder.name.includes('下班'));
}

export function formatTaskRule(reminder: Reminder, now: Date, workdayReminder?: Reminder) {
  const time = reminder.todayOverrideTime || reminder.dailyTime;
  const repeatDescription = formatRepeatDescription(reminder, now, workdayReminder);
  return [formatDateKey(getReminderDueDateKey(reminder, now)), time, repeatDescription].filter(Boolean).join(' ');
}

function formatRepeatDescription(reminder: Reminder, now: Date, workdayReminder?: Reminder) {
  if (reminder.repeatRule === 'once') {
    return '';
  }
  if (reminder.repeatRule === 'daily') {
    return '每天重复';
  }

  const days = getReminderRepeatDays(reminder, now);
  if (days.length === 0) {
    return '';
  }

  const workdayDays = getWorkdayRepeatDays(workdayReminder, now);
  if (workdayDays.length > 0 && areSameWeekDays(days, workdayDays)) {
    return '工作日重复';
  }

  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return `${formatCurrentWeekRepeatDays(days)}重复`;
  }

  return `${formatWeeklyRepeatDays(days)}重复`;
}

export function getWorkdayRepeatDefaults(workdayReminder: Reminder | undefined, fallbackDays = DEFAULT_WORK_WEEK_DAYS) {
  const normalizedFallbackDays = orderWeekDays(fallbackDays);
  if (!workdayReminder || !workdayReminder.enabled) {
    return {
      weeklyDays: normalizedFallbackDays,
      alternateWeekAnchorDate: undefined,
      alternateWeekDays: normalizedFallbackDays,
      alternateNextWeekDays: normalizedFallbackDays
    };
  }

  if (workdayReminder.useAlternateWeeks || workdayReminder.repeatRule === 'alternate-weeks') {
    const alternateWeekDays = orderWeekDays(workdayReminder.alternateWeekDays?.length ? workdayReminder.alternateWeekDays : normalizedFallbackDays);
    const alternateNextWeekDays = orderWeekDays(workdayReminder.alternateNextWeekDays?.length ? workdayReminder.alternateNextWeekDays : normalizedFallbackDays);
    return {
      weeklyDays: orderWeekDays(getAlternateWeekDays(workdayReminder, new Date())),
      alternateWeekAnchorDate: workdayReminder.alternateWeekAnchorDate,
      alternateWeekDays,
      alternateNextWeekDays
    };
  }

  if (workdayReminder.repeatRule === 'weekdays' || workdayReminder.repeatRule === 'weekly') {
    const weeklyDays = orderWeekDays(workdayReminder.weeklyDays?.length ? workdayReminder.weeklyDays : normalizedFallbackDays);
    return {
      weeklyDays,
      alternateWeekAnchorDate: undefined,
      alternateWeekDays: weeklyDays,
      alternateNextWeekDays: weeklyDays
    };
  }

  return {
    weeklyDays: normalizedFallbackDays,
    alternateWeekAnchorDate: undefined,
    alternateWeekDays: normalizedFallbackDays,
    alternateNextWeekDays: normalizedFallbackDays
  };
}

function getReminderRepeatDays(reminder: Reminder, now: Date) {
  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return orderWeekDays(getAlternateWeekDays(reminder, now));
  }
  if (reminder.repeatRule === 'weekdays') {
    return orderWeekDays(reminder.weeklyDays?.length ? reminder.weeklyDays : DEFAULT_WORK_WEEK_DAYS);
  }
  if (reminder.repeatRule === 'weekly') {
    return orderWeekDays(reminder.weeklyDays || []);
  }
  return [];
}

function getWorkdayRepeatDays(reminder: Reminder | undefined, now: Date) {
  if (!reminder || !reminder.enabled) {
    return [];
  }
  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return orderWeekDays(getAlternateWeekDays(reminder, now));
  }
  if (reminder.repeatRule === 'weekdays' || reminder.repeatRule === 'weekly') {
    return orderWeekDays(reminder.weeklyDays?.length ? reminder.weeklyDays : DEFAULT_WORK_WEEK_DAYS);
  }
  return [];
}

function formatWeeklyRepeatDays(days: number[]) {
  const orderedDays = orderWeekDays(days);
  if (orderedDays.length === 1) {
    return `每${formatWeekdayName(orderedDays[0])}`;
  }
  if (isContinuousWeekRange(orderedDays)) {
    return `每${formatWeekdayName(orderedDays[0])}～${formatWeekdayLabel(orderedDays[orderedDays.length - 1])}`;
  }
  return `每${orderedDays.map((day, index) => (index === 0 ? formatWeekdayName(day) : formatWeekdayLabel(day))).join('、')}`;
}

function formatCurrentWeekRepeatDays(days: number[]) {
  const orderedDays = orderWeekDays(days);
  if (orderedDays.length === 1) {
    return `本${formatWeekdayName(orderedDays[0])}`;
  }
  if (isContinuousWeekRange(orderedDays)) {
    return `本${formatWeekdayName(orderedDays[0])}～${formatWeekdayLabel(orderedDays[orderedDays.length - 1])}`;
  }
  return `本${orderedDays.map((day, index) => (index === 0 ? formatWeekdayName(day) : formatWeekdayLabel(day))).join('、')}`;
}

function orderWeekDays(days: number[]) {
  const uniqueDays = Array.from(new Set(days.filter((day) => WEEK_DAYS.some((item) => item.value === day))));
  return WEEK_DAYS.map((day) => day.value).filter((day) => uniqueDays.includes(day));
}

function isContinuousWeekRange(days: number[]) {
  if (days.length < 2) {
    return false;
  }
  const indexes = days.map((day) => WEEK_DAYS.findIndex((item) => item.value === day));
  return indexes.every((index, itemIndex) => itemIndex === 0 || index === indexes[itemIndex - 1] + 1);
}

function areSameWeekDays(first: number[], second: number[]) {
  const orderedFirst = orderWeekDays(first);
  const orderedSecond = orderWeekDays(second);
  return orderedFirst.length === orderedSecond.length && orderedFirst.every((day, index) => day === orderedSecond[index]);
}

function formatWeekdayName(dayValue: number) {
  const label = formatWeekdayLabel(dayValue);
  return label ? `周${label}` : '';
}

function formatWeekdayLabel(dayValue: number) {
  const label = WEEK_DAYS.find((day) => day.value === dayValue)?.label;
  return label || '';
}

export function formatTodayOffWorkTime(reminder: Reminder, now: Date) {
  return `今天 ${getTodayOffWorkTime(reminder, now)} 下班`;
}

export function formatReminderNotifyTime(reminder: Reminder, now: Date) {
  if (reminder.advanceMinutes <= 0) {
    return '';
  }

  return `将在 ${shiftTimeByMinutes(getTodayOffWorkTime(reminder, now), -reminder.advanceMinutes)} 提醒你`;
}

function getTodayOffWorkTime(reminder: Reminder, now: Date) {
  const todayKey = toDateKey(now);
  return reminder.todayOverrideDate === todayKey && reminder.todayOverrideTime
    ? reminder.todayOverrideTime
    : reminder.dailyTime;
}

export function shiftTimeByMinutes(time: string, offsetMinutes: number) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const totalMinutes = ((hour * 60 + minute + offsetMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

export function getOffWorkCountdownState(reminder: Reminder, now: Date): OffWorkCountdownState {
  if (!reminder.enabled) {
    return {
      text: '已暂停',
      showTimeMeta: true
    };
  }

  const target = getTodayReminderDate(reminder, now);
  if (!target) {
    return {
      text: '好好休息',
      showTimeMeta: false
    };
  }

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return {
      text: '好好休息',
      showTimeMeta: false
    };
  }

  const totalSeconds = Math.ceil(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    text: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    showTimeMeta: true
  };
}

export function getTodayReminderDate(reminder: Reminder, now: Date) {
  if (!shouldDisplayOnDate(reminder, now, toDateKey(now))) {
    return null;
  }

  const [hour = 18, minute = 0] = getTodayOffWorkTime(reminder, now).split(':').map(Number);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return target;
}

function shouldDisplayOnDate(reminder: Reminder, date: Date, dateKey: string) {
  if (reminder.repeatRule === 'once') {
    return reminder.scheduledDate === dateKey;
  }
  return shouldReminderRunOnDate(reminder, date, dateKey);
}

export function getTodayOverrideLabel(reminder: Reminder) {
  if (!reminder.todayOverrideTime) {
    return '今天早点走';
  }
  return timeToMinutes(reminder.todayOverrideTime) > timeToMinutes(reminder.dailyTime) ? '今天晚点走' : '今天早点走';
}

function timeToMinutes(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function createDueDatePatch(reminder: Reminder, scheduledDate: string): Partial<Reminder> {
  const patch: Partial<Reminder> = { scheduledDate };

  if (reminder.completed && scheduledDate > toDateKey(new Date())) {
    patch.completed = false;
    patch.completedAt = undefined;
  }

  return patch;
}

export function toggleDay(days: number[] | undefined, day: number) {
  const currentDays = days || [];
  return currentDays.includes(day)
    ? currentDays.filter((item) => item !== day)
    : [...currentDays, day].sort();
}
