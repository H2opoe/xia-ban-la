import type { ExternalEvent, LinkedExternalSource, Reminder } from './types.js';

type ExternalReminderPatch = Pick<Reminder, 'name' | 'repeatRule' | 'weeklyDays' | 'scheduledDate' | 'dailyTime'> & {
  linkedExternalSource: LinkedExternalSource;
};

export function createExternalReminderPatch(
  event: ExternalEvent,
  fallbackSource?: LinkedExternalSource
): ExternalReminderPatch {
  const start = new Date(event.startTime);

  return {
    name: event.title || fallbackSource?.title || '外部提醒事项',
    repeatRule: 'once',
    weeklyDays: [],
    scheduledDate: Number.isNaN(start.getTime()) ? toDateKey(new Date()) : toDateKey(start),
    dailyTime: Number.isNaN(start.getTime()) ? '18:00' : toTime(start),
    linkedExternalSource: {
      provider: event.provider,
      externalId: event.id,
      seriesId: event.seriesId || fallbackSource?.seriesId,
      title: event.title || fallbackSource?.title || '外部提醒事项',
      isRecurring: event.isRecurring ?? fallbackSource?.isRecurring,
      lastSyncedAt: new Date().toISOString(),
      syncStatus: 'ok'
    }
  };
}

export function getExternalEventLinkKeys(event: ExternalEvent) {
  return getExternalSourceLinkKeys({
    provider: event.provider,
    externalId: event.id,
    seriesId: event.seriesId
  });
}

export function getExternalSourceLinkKeys(source: Pick<LinkedExternalSource, 'provider' | 'externalId' | 'seriesId'>) {
  return [
    `${source.provider}:${source.externalId}`,
    source.seriesId ? `${source.provider}:${source.seriesId}` : ''
  ].filter(Boolean);
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
