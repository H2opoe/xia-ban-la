import { useEffect, useState } from 'react';
import type { Reminder } from '../../../../shared/types';
import { findOffWorkReminder } from '../../../domain/reminderText';

export type EditableReminderState = {
  reminder: Reminder;
  isDraft: boolean;
  workdayReminder?: Reminder;
};

async function getEditableReminderState(reminderId: string): Promise<EditableReminderState | null> {
  const reminders = await window.xiabanla.getReminders();
  const workdayReminder = findOffWorkReminder(reminders);
  const reminder = reminders.find((item) => item.id === reminderId);
  if (reminder) {
    return { reminder, isDraft: false, workdayReminder };
  }

  const draftReminder = await window.xiabanla.getDraftReminder(reminderId);
  return draftReminder ? { reminder: draftReminder, isDraft: true, workdayReminder } : null;
}

export function useEditableReminder(reminderId: string) {
  const [editableReminder, setEditableReminder] = useState<EditableReminderState | null>(null);

  useEffect(() => {
    void refresh();
    const unsubscribeReminders = window.xiabanla.onRemindersUpdated(() => {
      void refresh();
    });
    const unsubscribeDraft = window.xiabanla.onDraftReminderUpdated((id) => {
      if (id === reminderId) {
        void refresh();
      }
    });
    return () => {
      unsubscribeReminders();
      unsubscribeDraft();
    };

    async function refresh() {
      setEditableReminder(await getEditableReminderState(reminderId));
    }
  }, [reminderId]);

  return [editableReminder, setEditableReminder] as const;
}
