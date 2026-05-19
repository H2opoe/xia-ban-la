import type { Reminder, ReminderMessage } from '../shared/types.js';
import { getReminderNextTriggerDateKey, toDateKey } from '../shared/reminderSchedule.js';

export const DEFAULT_MESSAGES = [
  '洗洗水杯，准备下班',
  '上个厕所，准备下班',
  '收拾包包，准备下班',
  '关掉电脑，准备下班',
  '保存文件，准备下班',
  '伸个懒腰，准备下班'
];
const DEFAULT_WORK_WEEK_DAYS = [1, 2, 3, 4, 5];

export function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultMessages(messages = DEFAULT_MESSAGES): ReminderMessage[] {
  return messages.map((text, index) => ({
    id: `default_message_${index + 1}`,
    text,
    enabled: true
  }));
}

export function createDefaultExampleMoreReminders(primaryDisplayId: string): Reminder[] {
  return [
    createExampleReminder(primaryDisplayId, {
      id: 'default-example-weekly-meeting',
      name: '例会',
      dailyTime: '10:00',
      weeklyDays: [1],
      message: '每周一早上10点例会'
    }),
    createExampleReminder(primaryDisplayId, {
      id: 'default-example-order-lunch',
      name: '点外卖',
      dailyTime: '11:00',
      weeklyDays: [1, 2, 3, 4, 5],
      message: '周一到周五早上11点点外卖'
    })
  ];
}

type ExampleReminderOptions = {
  id: string;
  name: string;
  dailyTime: string;
  weeklyDays: number[];
  message: string;
};

function createExampleReminder(primaryDisplayId: string, options: ExampleReminderOptions): Reminder {
  const reminder: Reminder = {
    id: options.id,
    name: options.name,
    createdAt: new Date(0).toISOString(),
    enabled: true,
    completed: false,
    completedAt: undefined,
    repeatRule: 'weekly',
    weeklyDays: options.weeklyDays,
    useAlternateWeeks: false,
    alternateWeekDays: [],
    alternateNextWeekDays: [],
    scheduledDate: toDateKey(new Date()),
    dailyTime: options.dailyTime,
    advanceMinutes: 0,
    repeatUntilDismissed: false,
    repeatIntervalMinutes: 5,
    messages: [{ id: `${options.id}_message`, text: options.message, enabled: true }],
    selectedDisplayIds: [primaryDisplayId]
  };
  return {
    ...reminder,
    scheduledDate: getReminderNextTriggerDateKey(reminder)
  };
}
