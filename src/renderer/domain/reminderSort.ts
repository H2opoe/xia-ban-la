import { getReminderDueDateKey } from '../../shared/reminderSchedule';
import type { Reminder } from '../../shared/types';
import { getTodayReminderDate } from './reminderText';

export function isReminderPastDue(reminder: Reminder, now: Date) {
  if (reminder.completed) {
    return false;
  }

  const deadline = getReminderDeadline(reminder, now);
  return Boolean(deadline && deadline.getTime() < now.getTime());
}

function getReminderDeadline(reminder: Reminder, now: Date) {
  if (reminder.repeatRule !== 'once') {
    return getTodayReminderDate(reminder, now);
  }

  const [hour = 0, minute = 0] = (reminder.todayOverrideTime || reminder.dailyTime).split(':').map(Number);
  const [year = '0', month = '1', day = '1'] = reminder.scheduledDate.split('-');
  const deadline = new Date(Number(year), Number(month) - 1, Number(day), hour, minute, 0, 0);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

export function compareRemindersForMenu(first: Reminder, second: Reminder, now: Date) {
  if (Boolean(first.completed) !== Boolean(second.completed)) {
    return first.completed ? 1 : -1;
  }

  if (!first.completed && !second.completed) {
    return compareNumbers(getReminderDueSortTime(first, now), getReminderDueSortTime(second, now), getReminderCreatedSortTime(first), getReminderCreatedSortTime(second));
  }

  return compareNumbers(getCompletedSortTime(second), getCompletedSortTime(first), getReminderCreatedSortTime(first), getReminderCreatedSortTime(second));
}

function compareNumbers(first: number, second: number, firstCreatedTime: number, secondCreatedTime: number) {
  if (first !== second) {
    return first - second;
  }
  return secondCreatedTime - firstCreatedTime;
}

function getReminderDueSortTime(reminder: Reminder, now: Date) {
  const dueDateKey = getReminderDueDateKey(reminder, now);
  if (!dueDateKey) {
    return Number.POSITIVE_INFINITY;
  }

  const [hour = 0, minute = 0] = (reminder.todayOverrideTime || reminder.dailyTime).split(':').map(Number);
  const dueDate = new Date(`${dueDateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
  const dueTime = dueDate.getTime();
  return Number.isNaN(dueTime) ? Number.POSITIVE_INFINITY : dueTime;
}

function getCompletedSortTime(reminder: Reminder) {
  const completedTime = new Date(reminder.completedAt || '').getTime();
  return Number.isNaN(completedTime) ? 0 : completedTime;
}

function getReminderCreatedSortTime(reminder: Reminder) {
  const createdTime = new Date(reminder.createdAt || '').getTime();
  if (!Number.isNaN(createdTime)) {
    return createdTime;
  }

  const [, timestamp] = reminder.id.match(/^[^_]+_(\d+)_/) || [];
  const idTime = Number(timestamp);
  return Number.isFinite(idTime) ? idTime : 0;
}
