import { useEffect, useState } from 'react';
import { createExternalReminderPatch } from '../../../shared/externalReminder';
import type { DisplayInfo, ExternalEvent, ExternalSourceAccess, Reminder } from '../../../shared/types';
import { createReminder } from '../../domain/reminderFactory';
import {
  formatExternalEventMeta,
  formatExternalEventTitle,
  getExternalEmptyText,
  getExternalLoadingText,
  isExternalEventLinked,
  shouldShowExternalReminderInList
} from '../../domain/externalEventViewModel';
import { FloatingMenuSurface } from './floatingSurfaceModel';

type ExternalPanelTab = 'calendar' | 'reminders';

export function FloatingExternalSyncMenu() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [externalAccess, setExternalAccess] = useState<ExternalSourceAccess[]>([]);
  const [externalEventsLoading, setExternalEventsLoading] = useState(true);
  const [externalPanelTab, setExternalPanelTab] = useState<ExternalPanelTab>('calendar');
  const calendarExternalEvents = externalEvents.filter((event) => event.provider === 'macos-calendar');
  const reminderExternalEvents = externalEvents.filter(shouldShowExternalReminderInList);
  const activeExternalEvents = externalPanelTab === 'calendar' ? calendarExternalEvents : reminderExternalEvents;
  const activeExternalEmptyText = getExternalEmptyText(externalPanelTab, externalAccess);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.xiabanla.onRemindersUpdated(setReminders);
    return unsubscribe;

    async function refresh() {
      setExternalEventsLoading(true);
      try {
        const [nextReminders, nextDisplays, result] = await Promise.all([
          window.xiabanla.getReminders(),
          window.xiabanla.getDisplays(),
          window.xiabanla.listExternalEvents()
        ]);
        setReminders(nextReminders);
        setDisplays(nextDisplays);
        setExternalEvents(result.events);
        setExternalAccess(result.access);
      } finally {
        setExternalEventsLoading(false);
      }
    }
  }, []);

  async function addExternalReminder(event: ExternalEvent) {
    if (isExternalEventLinked(event, reminders)) {
      return;
    }
    const primaryDisplay = displays.find((display) => display.isPrimary) || displays[0];
    await window.xiabanla.saveReminder(createReminder(primaryDisplay?.id, {
      ...createExternalReminderPatch(event)
    }));
  }

  return (
    <FloatingMenuSurface className="external-popover" id="external-sync-panel">
      <div className="panel-heading">
        <h2>本机日程&提醒</h2>
        <div className="external-tabs" role="tablist" aria-label="本机同步类型">
          <button type="button" className={externalPanelTab === 'calendar' ? 'selected' : ''} onClick={() => setExternalPanelTab('calendar')} role="tab" aria-selected={externalPanelTab === 'calendar'}>日历日程</button>
          <button type="button" className={externalPanelTab === 'reminders' ? 'selected' : ''} onClick={() => setExternalPanelTab('reminders')} role="tab" aria-selected={externalPanelTab === 'reminders'}>提醒事项</button>
        </div>
      </div>
      <div className="compact-list external-popover-list">
        {externalEventsLoading && <div className="empty-state">{getExternalLoadingText(externalPanelTab)}</div>}
        {!externalEventsLoading && activeExternalEvents.length === 0 && <div className="empty-state">{activeExternalEmptyText}</div>}
        {activeExternalEvents.map((event) => {
          const linked = isExternalEventLinked(event, reminders);
          const title = formatExternalEventTitle(event);
          const meta = formatExternalEventMeta(event, linked);
          return (
            <button type="button" className={linked ? 'external-row external-row-linked' : 'external-row'} key={`${event.provider}:${event.id}`} onClick={() => void addExternalReminder(event)} disabled={linked}>
              <span>{title}</span>
              <small>{meta}</small>
            </button>
          );
        })}
      </div>
    </FloatingMenuSurface>
  );
}
