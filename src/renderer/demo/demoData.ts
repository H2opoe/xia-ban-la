import { OFF_WORK_REMINDER_ID } from '../../shared/reminderConstants';
import type { AppSettings, DisplayInfo, ExternalEvent, Reminder, ReminderMessage, ReminderPayload } from '../../shared/types';
import { toDateKey } from '../../shared/reminderSchedule';

const DEMO_DISPLAY_ID = 'demo-primary-display';
const DEMO_CREATED_AT = '2026-05-21T02:00:00.000Z';

export const demoDisplay: DisplayInfo = {
  id: DEMO_DISPLAY_ID,
  label: '内建显示器',
  isPrimary: true,
  bounds: {
    x: 0,
    y: 0,
    width: 1512,
    height: 982
  }
};

export const demoDefaultMessages: ReminderMessage[] = [
  { id: 'demo-default-message-1', text: '保存文件，准备下班', enabled: true },
  { id: 'demo-default-message-2', text: '洗洗水杯，准备下班', enabled: true },
  { id: 'demo-default-message-3', text: '别忘了拿工牌和耳机', enabled: true }
];

export const demoAppSettings: AppSettings = {
  lockScreenAfterIdle: true,
  selectedDisplayIds: [DEMO_DISPLAY_ID],
  themeMode: 'light'
};

export function createDemoReminders(now = new Date()): Reminder[] {
  const today = toDateKey(now);
  return [
    {
      id: OFF_WORK_REMINDER_ID,
      name: '18:30 下班',
      createdAt: DEMO_CREATED_AT,
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'weekly',
      weeklyDays: [1, 2, 3, 4, 5],
      useAlternateWeeks: false,
      alternateWeekDays: [1, 2, 3, 4, 5],
      alternateNextWeekDays: [1, 2, 3, 4, 5],
      scheduledDate: today,
      dailyTime: '18:30',
      advanceMinutes: 10,
      repeatUntilDismissed: true,
      repeatIntervalMinutes: 5,
      messages: demoDefaultMessages,
      selectedDisplayIds: [DEMO_DISPLAY_ID]
    },
    {
      id: 'demo-order-lunch',
      name: '点外卖',
      createdAt: '2026-05-21T02:06:00.000Z',
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'weekly',
      weeklyDays: [1, 2, 3, 4, 5],
      useAlternateWeeks: false,
      alternateWeekDays: [1, 2, 3, 4, 5],
      alternateNextWeekDays: [],
      scheduledDate: today,
      dailyTime: '11:10',
      advanceMinutes: 0,
      repeatUntilDismissed: false,
      repeatIntervalMinutes: 5,
      messages: [{ id: 'demo-order-lunch-message', text: '饭点前先点好，别等电梯口才想起来', enabled: true }],
      selectedDisplayIds: [DEMO_DISPLAY_ID]
    },
    {
      id: 'demo-flash-sale',
      name: '20:00 抢购护肤品',
      createdAt: '2026-05-21T02:08:00.000Z',
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'once',
      weeklyDays: [4],
      useAlternateWeeks: false,
      alternateWeekDays: [],
      alternateNextWeekDays: [],
      scheduledDate: today,
      dailyTime: '19:58',
      advanceMinutes: 2,
      repeatUntilDismissed: true,
      repeatIntervalMinutes: 1,
      messages: [{ id: 'demo-flash-sale-message', text: '提前打开购物车，别错过满减', enabled: true }],
      selectedDisplayIds: [DEMO_DISPLAY_ID]
    },
    {
      id: 'demo-concert-ticket',
      name: '抢演唱会票',
      createdAt: '2026-05-21T02:10:00.000Z',
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'once',
      weeklyDays: [5],
      useAlternateWeeks: false,
      alternateWeekDays: [],
      alternateNextWeekDays: [],
      scheduledDate: today,
      dailyTime: '11:58',
      advanceMinutes: 5,
      repeatUntilDismissed: true,
      repeatIntervalMinutes: 1,
      messages: [{ id: 'demo-concert-ticket-message', text: '检查账号、收货地址和支付方式', enabled: true }],
      selectedDisplayIds: [DEMO_DISPLAY_ID]
    },
    {
      id: 'demo-alternate-week-report',
      name: '大小周周报',
      createdAt: '2026-05-21T02:12:00.000Z',
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'weekly',
      weeklyDays: [5],
      useAlternateWeeks: true,
      alternateWeekAnchorDate: today,
      alternateWeekDays: [5],
      alternateNextWeekDays: [6],
      scheduledDate: today,
      dailyTime: '17:45',
      advanceMinutes: 15,
      repeatUntilDismissed: false,
      repeatIntervalMinutes: 5,
      messages: [{ id: 'demo-alternate-week-report-message', text: '这周要按大小周安排提交周报', enabled: true }],
      selectedDisplayIds: [DEMO_DISPLAY_ID]
    },
    {
      id: 'demo-calendar-product-meeting',
      name: '产品晨会',
      createdAt: '2026-05-21T02:14:00.000Z',
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'once',
      weeklyDays: [],
      useAlternateWeeks: false,
      alternateWeekDays: [],
      alternateNextWeekDays: [],
      scheduledDate: today,
      dailyTime: '09:30',
      advanceMinutes: 10,
      repeatUntilDismissed: false,
      repeatIntervalMinutes: 5,
      messages: [{ id: 'demo-calendar-product-meeting-message', text: '同步自本机日历：带上昨天下午的需求记录', enabled: true }],
      selectedDisplayIds: [DEMO_DISPLAY_ID],
      linkedExternalSource: {
        provider: 'macos-calendar',
        externalId: 'demo-calendar-product-meeting',
        seriesId: 'demo-calendar-product-meeting-series',
        title: '产品晨会',
        isRecurring: true,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'ok'
      }
    },
    {
      id: 'demo-macos-reminder-rent',
      name: '交房租',
      createdAt: '2026-05-21T02:16:00.000Z',
      enabled: true,
      completed: false,
      completedAt: undefined,
      repeatRule: 'once',
      weeklyDays: [],
      useAlternateWeeks: false,
      alternateWeekDays: [],
      alternateNextWeekDays: [],
      scheduledDate: today,
      dailyTime: '21:00',
      advanceMinutes: 30,
      repeatUntilDismissed: true,
      repeatIntervalMinutes: 10,
      messages: [{ id: 'demo-macos-reminder-rent-message', text: '同步自本机提醒事项：记得截图留底', enabled: true }],
      selectedDisplayIds: [DEMO_DISPLAY_ID],
      linkedExternalSource: {
        provider: 'macos-reminders',
        externalId: 'demo-macos-reminder-rent',
        title: '交房租',
        isRecurring: false,
        lastSyncedAt: new Date().toISOString(),
        syncStatus: 'ok'
      }
    }
  ];
}

export function createDemoExternalEvents(now = new Date()): ExternalEvent[] {
  const today = toDateKey(now);
  return [
    {
      id: 'demo-calendar-product-meeting',
      seriesId: 'demo-calendar-product-meeting-series',
      provider: 'macos-calendar',
      title: '产品晨会',
      startTime: `${today}T09:30:00+08:00`,
      isRecurring: true
    },
    {
      id: 'demo-calendar-standup',
      provider: 'macos-calendar',
      title: '部门站会',
      startTime: `${today}T14:00:00+08:00`,
      isRecurring: true
    },
    {
      id: 'demo-calendar-gym',
      provider: 'macos-calendar',
      title: '下班后瑜伽课',
      startTime: `${today}T19:30:00+08:00`
    },
    {
      id: 'demo-macos-reminder-rent',
      provider: 'macos-reminders',
      title: '交房租',
      startTime: `${today}T21:00:00+08:00`,
      completed: false
    },
    {
      id: 'demo-macos-reminder-takeout-coupon',
      provider: 'macos-reminders',
      title: '领外卖红包',
      startTime: `${today}T10:55:00+08:00`,
      completed: false
    },
    {
      id: 'demo-macos-reminder-pack',
      provider: 'macos-reminders',
      title: '带充电器回家',
      startTime: `${today}T18:20:00+08:00`,
      completed: false
    }
  ];
}

export function createDemoReminderPayload(now = new Date()): ReminderPayload {
  return {
    reminderId: 'demo-concert-ticket:preview',
    title: '抢演唱会票',
    message: '检查账号、收货地址和支付方式',
    currentTime: now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  };
}
