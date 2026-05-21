#!/usr/bin/env node

const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const targetDir = resolve(process.argv[2] || 'docs/demo/runtime-data');
const displayId = 'demo-primary-display';
const today = formatDateKey(new Date());

const defaultMessages = [
  { id: 'demo-default-message-1', text: '保存文件，准备下班', enabled: true },
  { id: 'demo-default-message-2', text: '洗洗水杯，准备下班', enabled: true },
  { id: 'demo-default-message-3', text: '别忘了拿工牌和耳机', enabled: true }
];

const reminders = [
  createReminder({
    id: 'default-off-work',
    name: '18:30 下班',
    createdAt: '2026-05-21T02:00:00.000Z',
    repeatRule: 'weekly',
    weeklyDays: [1, 2, 3, 4, 5],
    alternateWeekDays: [1, 2, 3, 4, 5],
    dailyTime: '18:30',
    advanceMinutes: 10,
    repeatUntilDismissed: true,
    messages: defaultMessages
  }),
  createReminder({
    id: 'demo-order-lunch',
    name: '点外卖',
    createdAt: '2026-05-21T02:06:00.000Z',
    repeatRule: 'weekly',
    weeklyDays: [1, 2, 3, 4, 5],
    alternateWeekDays: [1, 2, 3, 4, 5],
    dailyTime: '11:10',
    messages: [{ id: 'demo-order-lunch-message', text: '饭点前先点好，别等电梯口才想起来', enabled: true }]
  }),
  createReminder({
    id: 'demo-flash-sale',
    name: '20:00 抢购护肤品',
    createdAt: '2026-05-21T02:08:00.000Z',
    repeatRule: 'once',
    weeklyDays: [4],
    dailyTime: '19:58',
    advanceMinutes: 2,
    repeatUntilDismissed: true,
    repeatIntervalMinutes: 1,
    messages: [{ id: 'demo-flash-sale-message', text: '提前打开购物车，别错过满减', enabled: true }]
  }),
  createReminder({
    id: 'demo-concert-ticket',
    name: '抢演唱会票',
    createdAt: '2026-05-21T02:10:00.000Z',
    repeatRule: 'once',
    weeklyDays: [5],
    dailyTime: '11:58',
    advanceMinutes: 5,
    repeatUntilDismissed: true,
    repeatIntervalMinutes: 1,
    messages: [{ id: 'demo-concert-ticket-message', text: '检查账号、收货地址和支付方式', enabled: true }]
  }),
  createReminder({
    id: 'demo-alternate-week-report',
    name: '大小周周报',
    createdAt: '2026-05-21T02:12:00.000Z',
    repeatRule: 'weekly',
    weeklyDays: [5],
    useAlternateWeeks: true,
    alternateWeekAnchorDate: today,
    alternateWeekDays: [5],
    alternateNextWeekDays: [6],
    dailyTime: '17:45',
    advanceMinutes: 15,
    messages: [{ id: 'demo-alternate-week-report-message', text: '这周要按大小周安排提交周报', enabled: true }]
  }),
  createReminder({
    id: 'demo-calendar-product-meeting',
    name: '产品晨会',
    createdAt: '2026-05-21T02:14:00.000Z',
    repeatRule: 'once',
    weeklyDays: [],
    dailyTime: '09:30',
    advanceMinutes: 10,
    messages: [{ id: 'demo-calendar-product-meeting-message', text: '同步自本机日历：带上昨天下午的需求记录', enabled: true }],
    linkedExternalSource: {
      provider: 'macos-calendar',
      externalId: 'demo-calendar-product-meeting',
      seriesId: 'demo-calendar-product-meeting-series',
      title: '产品晨会',
      isRecurring: true,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'ok'
    }
  }),
  createReminder({
    id: 'demo-macos-reminder-rent',
    name: '交房租',
    createdAt: '2026-05-21T02:16:00.000Z',
    repeatRule: 'once',
    weeklyDays: [],
    dailyTime: '21:00',
    advanceMinutes: 30,
    repeatUntilDismissed: true,
    repeatIntervalMinutes: 10,
    messages: [{ id: 'demo-macos-reminder-rent-message', text: '同步自本机提醒事项：记得截图留底', enabled: true }],
    linkedExternalSource: {
      provider: 'macos-reminders',
      externalId: 'demo-macos-reminder-rent',
      title: '交房租',
      isRecurring: false,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'ok'
    }
  })
];

const payload = {
  reminders,
  defaultMessages,
  settings: {
    lockScreenAfterIdle: true,
    selectedDisplayIds: [displayId],
    themeMode: 'light'
  },
  exampleMoreRemindersSeeded: true
};

mkdirSync(targetDir, { recursive: true });
writeFileSync(join(targetDir, 'reminders.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`已生成 demo 数据：${join(targetDir, 'reminders.json')}`);

function createReminder(overrides) {
  return {
    id: overrides.id,
    name: overrides.name,
    createdAt: overrides.createdAt,
    enabled: true,
    completed: false,
    completedAt: undefined,
    repeatRule: overrides.repeatRule,
    weeklyDays: overrides.weeklyDays || [1, 2, 3, 4, 5],
    useAlternateWeeks: Boolean(overrides.useAlternateWeeks),
    alternateWeekAnchorDate: overrides.alternateWeekAnchorDate,
    alternateWeekDays: overrides.alternateWeekDays || [],
    alternateNextWeekDays: overrides.alternateNextWeekDays || [],
    scheduledDate: today,
    dailyTime: overrides.dailyTime,
    advanceMinutes: overrides.advanceMinutes || 0,
    repeatUntilDismissed: Boolean(overrides.repeatUntilDismissed),
    repeatIntervalMinutes: overrides.repeatIntervalMinutes || 5,
    messages: overrides.messages,
    selectedDisplayIds: [displayId],
    linkedExternalSource: overrides.linkedExternalSource
  };
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
