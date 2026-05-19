import type { Reminder } from '../../shared/types';
import { getReminderNextDateKey, toDateKey } from '../../shared/reminderSchedule';

export { toDateKey } from '../../shared/reminderSchedule';

export function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return toDateKey(nextDate);
}

export function getNextRepeatDateKey(reminder: Reminder, fromDate = new Date()) {
  return getReminderNextDateKey(reminder, fromDate);
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function getCalendarMonth(dateKey?: string) {
  const date = dateKey ? parseDateKey(dateKey) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      dateKey: toDateKey(date),
      dayOfMonth: date.getDate(),
      inCurrentMonth: date.getMonth() === month.getMonth()
    };
  });
}

export function formatCalendarMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function parseDateKey(dateKey: string) {
  const [year = '0', month = '1', day = '1'] = dateKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDateInputValue(value: string) {
  const normalizedDate = normalizeDateInput(value);
  return normalizedDate ? normalizedDate.replaceAll('-', '/') : value.replaceAll('-', '/');
}

export function limitDateDraft(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 6) {
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6)}`;
  }
  if (digits.length > 4) {
    return `${digits.slice(0, 4)}/${digits.slice(4)}`;
  }
  return digits;
}

export function normalizeDateInput(value: string) {
  const trimmedValue = value.trim().replaceAll('-', '/');
  const slashMatch = trimmedValue.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const compactMatch = trimmedValue.match(/^(\d{4})(\d{2})(\d{2})$/);
  const match = slashMatch || compactMatch;
  if (!match) {
    return '';
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return '';
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatTimeInputValue(value: string) {
  return normalizeTimeInput(value) || value;
}

export function limitTimeDraft(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length === 3) {
    const trailingMinutes = Number(digits.slice(1));
    if (trailingMinutes <= 59) {
      return `${digits.slice(0, 1)}:${digits.slice(1)}`;
    }
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function normalizeTimeInput(value: string) {
  const trimmedValue = value.trim();
  const colonMatch = trimmedValue.match(/^(\d{1,2}):(\d{1,2})$/);
  const digitMatch = trimmedValue.match(/^\d{1,4}$/);
  if (!colonMatch && !digitMatch) {
    return '';
  }

  let hour = 0;
  let minute = 0;

  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2].padEnd(2, '0'));
  } else {
    const paddedValue = trimmedValue.padStart(4, '0');
    hour = Number(paddedValue.slice(0, 2));
    minute = Number(paddedValue.slice(2, 4));
  }

  if (hour > 23 || minute > 59) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isTimeDraftReadyToCommit(value: string) {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, '');
  if (digits.length >= 4) {
    return true;
  }
  if (digits.length === 3) {
    return Number(digits.slice(0, 2)) > 23 && Number(digits.slice(1)) <= 59;
  }
  return false;
}

export function nextHourTime(date: Date) {
  const next = new Date(date);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return toTime(next);
}

export function formatDateKey(dateKey?: string) {
  if (!dateKey) return '无截止日期';
  const [, month = '', day = ''] = dateKey.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
