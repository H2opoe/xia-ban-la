import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { DisplayInfo, Reminder, ReminderMessage } from '../../../shared/types';

type ReminderPersistenceOptions = {
  setDefaultMessageDrafts: Dispatch<SetStateAction<ReminderMessage[]>>;
  setDisplays: Dispatch<SetStateAction<DisplayInfo[]>>;
  setNotice: (notice: string) => void;
};

export function useReminderPersistence(options: ReminderPersistenceOptions) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const remindersRef = useRef<Reminder[]>([]);
  const latestSaveVersionRef = useRef(new Map<string, number>());
  const deletedReminderIdsRef = useRef(new Set<string>());

  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  async function refresh() {
    const [nextReminders, nextDisplays, nextDefaultMessages] = await Promise.all([
      window.xiabanla.getReminders(),
      window.xiabanla.getDisplays(),
      window.xiabanla.getDefaultMessages()
    ]);
    setReminders(nextReminders);
    options.setDisplays(nextDisplays);
    options.setDefaultMessageDrafts(nextDefaultMessages);
    options.setNotice('配置已加载');
  }

  function upsertReminder(reminder: Reminder) {
    setReminders((items) => {
      const exists = items.some((item) => item.id === reminder.id);
      return exists ? items.map((item) => (item.id === reminder.id ? reminder : item)) : [reminder, ...items];
    });
  }

  async function saveReminder(reminder: Reminder, message = '已自动保存') {
    deletedReminderIdsRef.current.delete(reminder.id);
    const saveVersion = (latestSaveVersionRef.current.get(reminder.id) || 0) + 1;
    latestSaveVersionRef.current.set(reminder.id, saveVersion);
    upsertReminder(reminder);
    options.setNotice('正在自动保存...');

    const saveTask = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (deletedReminderIdsRef.current.has(reminder.id)) {
          return reminder;
        }
        const saved = await window.xiabanla.saveReminder(reminder);
        const isLatestSave = latestSaveVersionRef.current.get(reminder.id) === saveVersion;
        if (isLatestSave && !deletedReminderIdsRef.current.has(reminder.id)) {
          upsertReminder(saved);
          options.setNotice(message);
        }
        return saved;
      });

    saveQueueRef.current = saveTask.then(() => undefined);

    try {
      return await saveTask;
    } catch (error) {
      if (latestSaveVersionRef.current.get(reminder.id) === saveVersion) {
        options.setNotice(error instanceof Error ? error.message : '自动保存失败');
      }
      throw error;
    }
  }

  async function deletePersistedReminder(reminder: Reminder, successNotice = '已删除提醒') {
    deletedReminderIdsRef.current.add(reminder.id);
    latestSaveVersionRef.current.delete(reminder.id);
    setReminders((items) => items.filter((item) => item.id !== reminder.id));
    options.setNotice('正在自动保存...');
    const deleteTask = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await window.xiabanla.deleteReminder(reminder.id);
        options.setNotice(successNotice);
      });
    saveQueueRef.current = deleteTask.then(() => undefined);
    await deleteTask;
  }

  return {
    deletePersistedReminder,
    refresh,
    reminders,
    remindersRef,
    saveReminder,
    setReminders
  };
}
