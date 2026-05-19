import { useEffect, useState } from 'react';
import { FloatingMenuSurface } from '../floatingSurfaceModel';

export function FloatingTitleWarningMenu(props: { reminderId: string; restoreTitle?: string }) {
  const { reminderId, restoreTitle } = props;
  const [reminderState, setReminderState] = useState<'draft' | 'saved' | 'missing'>('draft');

  useEffect(() => {
    void refresh();
    const unsubscribeDraft = window.xiabanla.onDraftReminderUpdated((id, reminder) => {
      if (id === reminderId) {
        if (reminder) {
          setReminderState('draft');
          return;
        }
        void refresh();
      }
    });
    const unsubscribeReminders = window.xiabanla.onRemindersUpdated(() => {
      void refresh();
    });
    return () => {
      unsubscribeDraft();
      unsubscribeReminders();
    };

    async function refresh() {
      if (await window.xiabanla.getDraftReminder(reminderId)) {
        setReminderState('draft');
        return;
      }
      const reminders = await window.xiabanla.getReminders();
      setReminderState(reminders.some((reminder) => reminder.id === reminderId) ? 'saved' : 'missing');
    }
  }, [reminderId]);

  async function returnToEdit() {
    await window.xiabanla.closeMenuFloatingSurface('title-warning');
  }

  async function undoEdit() {
    if (reminderState === 'draft') {
      await window.xiabanla.deleteDraftReminder(reminderId);
      await window.xiabanla.closeMenuFloatingSurface('title-warning');
      return;
    }

    const reminders = await window.xiabanla.getReminders();
    const reminder = reminders.find((item) => item.id === reminderId);
    if (reminder && restoreTitle !== undefined) {
      await window.xiabanla.saveReminder({ ...reminder, name: restoreTitle });
    }
    await window.xiabanla.closeMenuFloatingSurface('title-warning');
  }

  const exists = reminderState !== 'missing';
  return (
    <FloatingMenuSurface className="title-warning-menu" role="dialog" id="title-warning-menu">
      <strong>{exists ? '未输入标题' : '提醒不存在'}</strong>
      <div className="title-warning-actions">
        <button type="button" onClick={() => void returnToEdit()} disabled={!exists}>返回编辑</button>
        <button className="context-danger" type="button" onClick={() => void undoEdit()} disabled={!exists}>
          {reminderState === 'draft' ? '取消添加' : '撤销编辑'}
        </button>
      </div>
    </FloatingMenuSurface>
  );
}
