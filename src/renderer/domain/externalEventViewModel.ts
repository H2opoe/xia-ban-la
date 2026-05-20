import { getExternalAccessInstruction } from '../../shared/externalAccessMessages';
import { getExternalEventLinkKeys, getExternalSourceLinkKeys } from '../../shared/externalReminder';
import type { ExternalAccessKind, ExternalEvent, ExternalSourceAccess, Reminder } from '../../shared/types';
import { formatDateTime } from './dateTimeInput';

type ExternalPanelTab = 'calendar' | 'reminders';

export function getExternalEmptyText(tab: ExternalPanelTab, accessList: ExternalSourceAccess[]) {
  const kind: ExternalAccessKind = tab === 'calendar' ? 'calendar' : 'reminders';
  const access = accessList.find((item) => item.kind === kind);
  const defaultText = tab === 'calendar' ? '未读取到日历日程' : '未读取到提醒事项';

  if (!access || access.granted) {
    return defaultText;
  }

  if (access.message) {
    return access.message;
  }

  return getExternalAccessInstruction(kind, access.status);
}

export function getExternalLoadingText(tab: ExternalPanelTab) {
  return tab === 'calendar' ? '正在读取本机日历日程...' : '正在读取本机提醒事项...';
}

export function isExternalEventLinked(event: ExternalEvent, reminders: Reminder[]) {
  const eventLinkKeys = new Set(getExternalEventLinkKeys(event));
  return reminders.some((reminder) => (
    reminder.linkedExternalSource
    && getExternalSourceLinkKeys(reminder.linkedExternalSource).some((key) => eventLinkKeys.has(key))
  ));
}

export function formatExternalEventTitle(event: ExternalEvent) {
  const title = event.title.trim();
  if (title && title !== '提醒事项' && title !== '日历日程') {
    return title;
  }
  return event.provider === 'macos-reminders' ? '未命名提醒' : '未命名日程';
}

export function formatExternalEventMeta(event: ExternalEvent, linked: boolean) {
  const dateTime = formatDateTime(event.startTime);
  return linked ? `${dateTime} · 已同步` : dateTime;
}

export function isExternalEventHistorical(event: ExternalEvent, now = new Date()) {
  if (event.provider !== 'macos-reminders') {
    return false;
  }
  const eventDate = new Date(event.startTime);
  if (Number.isNaN(eventDate.getTime())) {
    return false;
  }
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return eventDate.getTime() < todayStart.getTime();
}

export function shouldShowExternalReminderInList(event: ExternalEvent) {
  // 已完成状态仍由同步流程使用，这里只控制“本机提醒事项”可绑定列表的展示范围。
  return event.provider === 'macos-reminders' && event.completed !== true && !isExternalEventHistorical(event);
}
