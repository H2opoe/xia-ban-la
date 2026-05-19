import { useEffect, useState } from 'react';
import { WEEK_DAYS } from '../../../../shared/reminderConstants';
import { getReminderDueDateKey } from '../../../../shared/reminderSchedule';
import {
  addDays,
  addMonths,
  formatCalendarMonth,
  getCalendarDays,
  getCalendarMonth,
  toDateKey
} from '../../../domain/dateTimeInput';
import { createDueDatePatch } from '../../../domain/reminderText';
import { FloatingMenuSurface } from '../floatingSurfaceModel';
import { useEditableReminder } from './useEditableReminder';

export function FloatingReminderDateMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [editableReminder] = useEditableReminder(reminderId);
  const [now, setNow] = useState(() => new Date());
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonth());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function saveDate(dateKey: string) {
    if (!editableReminder) {
      return;
    }
    const nextReminder = { ...editableReminder.reminder, ...createDueDatePatch(editableReminder.reminder, dateKey) };
    if (editableReminder.isDraft) {
      await window.xiabanla.saveDraftReminder(nextReminder);
    } else {
      await window.xiabanla.saveReminder(nextReminder);
    }
    await window.xiabanla.closeMenuFloatingSurface();
  }

  if (!editableReminder) {
    return <FloatingMenuSurface className="context-submenu context-date-submenu"><div className="context-readonly-hint">提醒不存在</div></FloatingMenuSurface>;
  }

  const reminder = editableReminder.reminder;
  const reminderDueDateKey = getReminderDueDateKey(reminder, now);
  const todayDateKey = toDateKey(now);
  return (
    <FloatingMenuSurface className="context-submenu context-date-submenu" role="menu">
      <div className="context-date-shortcuts" role="group" aria-label="快捷日期">
        <button role="menuitem" type="button" onClick={() => void saveDate(toDateKey(now))}>今天</button>
        <button role="menuitem" type="button" onClick={() => void saveDate(addDays(now, 1))}>明天</button>
        <button role="menuitem" type="button" onClick={() => void saveDate(addDays(now, 7))}>下周</button>
      </div>
      <section className="context-calendar" aria-label="日历视图">
        <div className="context-calendar-header">
          <button type="button" aria-label="上个月" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>‹</button>
          <strong>{formatCalendarMonth(calendarMonth)}</strong>
          <button type="button" aria-label="下个月" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>›</button>
        </div>
        <div className="context-calendar-weekdays" aria-hidden="true">
          {WEEK_DAYS.map((day) => <span key={day.value}>{day.label}</span>)}
        </div>
        <div className="context-calendar-grid">
          {getCalendarDays(calendarMonth).map((day) => (
            <button
              type="button"
              key={day.dateKey}
              className={[
                'context-calendar-day',
                day.inCurrentMonth ? '' : 'outside-month',
                day.dateKey === todayDateKey ? 'today' : '',
                day.dateKey === reminderDueDateKey ? 'selected' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => void saveDate(day.dateKey)}
            >
              <span className="context-calendar-day-number">{day.dayOfMonth}</span>
            </button>
          ))}
        </div>
      </section>
    </FloatingMenuSurface>
  );
}
