import { useEffect, useState } from 'react';
import type { Reminder } from '../../../../shared/types';
import { TimeField } from '../../../components/ReminderFields';
import { toDateKey } from '../../../domain/dateTimeInput';
import { shiftTimeByMinutes } from '../../../domain/reminderText';
import { FloatingMenuSurface } from '../floatingSurfaceModel';

export function FloatingTodayOverrideMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [reminder, setReminder] = useState<Reminder | null>(null);

  useEffect(() => {
    void window.xiabanla.getReminders().then((reminders) => setReminder(reminders.find((item) => item.id === reminderId) || null));
    const unsubscribe = window.xiabanla.onRemindersUpdated((reminders) => {
      setReminder(reminders.find((item) => item.id === reminderId) || null);
    });
    return unsubscribe;
  }, [reminderId]);

  async function updateTodayOverride(time: string) {
    if (!reminder) {
      return;
    }
    const saved = await window.xiabanla.saveReminder({
      ...reminder,
      todayOverrideTime: time || undefined,
      todayOverrideDate: time ? toDateKey(new Date()) : undefined
    });
    setReminder(saved);
  }

  function updateTodayOverrideByOffset(offsetMinutes: number) {
    if (reminder) {
      void updateTodayOverride(shiftTimeByMinutes(reminder.dailyTime, offsetMinutes));
    }
  }

  return (
    <FloatingMenuSurface className="tertiary-submenu">
      {reminder ? (
        <>
          <label>
            输入今天下班时间
            <TimeField
              value={reminder.todayOverrideTime || ''}
              placeholder={reminder.todayOverrideTime || reminder.dailyTime}
              allowEmpty
              commitOnValidChange
              onChange={updateTodayOverride}
            />
          </label>
          <div className="today-override-quick-actions">
            <button type="button" onClick={() => updateTodayOverrideByOffset(-120)}>早走 2 小时</button>
            <button type="button" onClick={() => updateTodayOverrideByOffset(120)}>晚走 2 小时</button>
          </div>
          {reminder.todayOverrideTime && <button type="button" onClick={() => void updateTodayOverride('')}>恢复默认</button>}
        </>
      ) : <div className="empty-state">提醒不存在</div>}
    </FloatingMenuSurface>
  );
}
