import { DEFAULT_WORK_WEEK_DAYS } from '../../shared/reminderConstants';
import type { Reminder } from '../../shared/types';
import { toDateKey } from '../../shared/reminderSchedule';

const DEFAULT_NEW_REMINDER_NAME = '新提醒';

export function createReminder(primaryDisplayId?: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: createClientId('reminder'),
    name: DEFAULT_NEW_REMINDER_NAME,
    createdAt: new Date().toISOString(),
    enabled: true,
    completed: false,
    completedAt: undefined,
    repeatRule: 'once',
    weeklyDays: [...DEFAULT_WORK_WEEK_DAYS],
    useAlternateWeeks: false,
    alternateWeekDays: [],
    alternateNextWeekDays: [],
    scheduledDate: toDateKey(new Date()),
    dailyTime: '18:00',
    advanceMinutes: 0,
    todayOverrideDate: undefined,
    repeatUntilDismissed: false,
    repeatIntervalMinutes: 5,
    messages: [{ id: createClientId('message'), text: '准备下班', enabled: true }],
    selectedDisplayIds: primaryDisplayId ? [primaryDisplayId] : [],
    ...overrides
  };
}

export function createCompletionPatch(reminder: Reminder): Partial<Reminder> {
  const completed = !reminder.completed;
  return {
    completed,
    completedAt: completed ? new Date().toISOString() : undefined
  };
}

export function cloneReminder(reminder: Reminder): Reminder {
  return {
    ...reminder,
    weeklyDays: reminder.weeklyDays ? [...reminder.weeklyDays] : undefined,
    alternateWeekDays: reminder.alternateWeekDays ? [...reminder.alternateWeekDays] : undefined,
    alternateNextWeekDays: reminder.alternateNextWeekDays ? [...reminder.alternateNextWeekDays] : undefined,
    messages: reminder.messages.map((message) => ({ ...message })),
    selectedDisplayIds: [...reminder.selectedDisplayIds],
    linkedExternalSource: reminder.linkedExternalSource ? { ...reminder.linkedExternalSource } : undefined
  };
}

export function createClientId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
