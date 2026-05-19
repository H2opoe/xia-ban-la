import { useEffect, useRef, useState } from 'react';
import type { Reminder } from '../../../shared/types';
import { cloneReminder } from '../../domain/reminderFactory';

const DELETE_UNDO_TIMEOUT_MS = 5_000;

export type DeleteUndoBatch = {
  reminders: Reminder[];
  version: number;
} | null;

export function useDeleteUndo(setNotice: (notice: string) => void) {
  const [deleteUndoBatch, setDeleteUndoBatch] = useState<DeleteUndoBatch>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const deleteUndoVersionRef = useRef(0);

  useEffect(() => () => clearDeleteUndoTimer(), []);

  function clearDeleteUndoTimer() {
    if (deleteUndoTimerRef.current === null) {
      return;
    }
    window.clearTimeout(deleteUndoTimerRef.current);
    deleteUndoTimerRef.current = null;
  }

  function scheduleDeleteUndoDismiss(version: number) {
    clearDeleteUndoTimer();
    deleteUndoTimerRef.current = window.setTimeout(() => {
      setDeleteUndoBatch((current) => (current?.version === version ? null : current));
      deleteUndoTimerRef.current = null;
    }, DELETE_UNDO_TIMEOUT_MS);
  }

  function addReminderToUndoBatch(reminder: Reminder) {
    const nextVersion = deleteUndoVersionRef.current + 1;
    deleteUndoVersionRef.current = nextVersion;
    setDeleteUndoBatch((current) => {
      const currentReminders = current?.reminders.filter((item) => item.id !== reminder.id) || [];
      return {
        reminders: [...currentReminders, cloneReminder(reminder)],
        version: nextVersion
      };
    });
    scheduleDeleteUndoDismiss(nextVersion);
  }

  async function restoreDeletedReminders(saveReminder: (reminder: Reminder, message?: string) => Promise<Reminder>) {
    if (!deleteUndoBatch) {
      return;
    }

    const remindersToRestore = deleteUndoBatch.reminders.map(cloneReminder);
    clearDeleteUndoTimer();
    setDeleteUndoBatch(null);
    setNotice('正在恢复提醒...');

    try {
      await Promise.all(remindersToRestore.map((reminder) => saveReminder(reminder, '已撤销删除')));
      setNotice(remindersToRestore.length > 1 ? `已恢复 ${remindersToRestore.length} 个提醒` : '已恢复提醒');
    } catch {
      // saveReminder 已经把具体错误写入状态栏，这里不再覆盖成笼统提示。
    }
  }

  return {
    addReminderToUndoBatch,
    deleteUndoBatch,
    restoreDeletedReminders
  };
}
