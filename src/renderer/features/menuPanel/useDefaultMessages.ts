import { useEffect, useRef, useState } from 'react';
import type { ReminderMessage } from '../../../shared/types';
import { createClientId } from '../../domain/reminderFactory';

const DEFAULT_MESSAGE_AUTO_SAVE_DELAY_MS = 500;

export function useDefaultMessages(setNotice: (notice: string) => void) {
  const [defaultMessageDrafts, setDefaultMessageDrafts] = useState<ReminderMessage[]>([]);
  const [defaultMessagesSaving, setDefaultMessagesSaving] = useState(false);
  const defaultMessagesAutoSaveTimerRef = useRef<number | null>(null);
  const defaultMessagesSaveVersionRef = useRef(0);

  useEffect(() => {
    const unsubscribeDefaultMessages = window.xiabanla.onDefaultMessagesUpdated((messages) => {
      setDefaultMessageDrafts(messages);
    });
    return () => {
      clearDefaultMessagesAutoSaveTimer();
      unsubscribeDefaultMessages();
    };
  }, []);

  function addDefaultMessageDraft() {
    setDefaultMessageDrafts((items) => [
      ...items,
      {
        id: createClientId('message'),
        text: '',
        enabled: true
      }
    ]);
    setNotice('已新增一条下班文案');
  }

  function updateDefaultMessageDraft(id: string, patch: Partial<ReminderMessage>) {
    setDefaultMessageDrafts((items) => {
      const nextMessages = items.map((message) => (
        message.id === id ? { ...message, ...patch } : message
      ));
      scheduleDefaultMessagesAutoSave(nextMessages);
      return nextMessages;
    });
  }

  function deleteDefaultMessageDraft(id: string) {
    if (defaultMessageDrafts.length <= 1) {
      setNotice('至少保留一条提醒文案');
      return;
    }

    clearDefaultMessagesAutoSaveTimer();
    setDefaultMessageDrafts((items) => {
      const nextMessages = items.filter((message) => message.id !== id);
      void persistDefaultMessages(nextMessages, {
        replaceDraftsWithSaved: true,
        successNotice: '已删除一条下班文案'
      });
      return nextMessages;
    });
  }

  function normalizeDefaultMessageDrafts(messages: ReminderMessage[]) {
    return messages
      .map((message) => ({
        ...message,
        text: message.text.trim()
      }))
      .filter((message) => message.text);
  }

  function clearDefaultMessagesAutoSaveTimer() {
    if (defaultMessagesAutoSaveTimerRef.current !== null) {
      window.clearTimeout(defaultMessagesAutoSaveTimerRef.current);
      defaultMessagesAutoSaveTimerRef.current = null;
    }
  }

  function scheduleDefaultMessagesAutoSave(messages: ReminderMessage[]) {
    clearDefaultMessagesAutoSaveTimer();
    defaultMessagesAutoSaveTimerRef.current = window.setTimeout(() => {
      defaultMessagesAutoSaveTimerRef.current = null;
      void persistDefaultMessages(messages, {
        successNotice: '已自动保存下班文案'
      });
    }, DEFAULT_MESSAGE_AUTO_SAVE_DELAY_MS);
  }

  async function persistDefaultMessages(
    messages: ReminderMessage[],
    options: { successNotice: string; replaceDraftsWithSaved?: boolean }
  ) {
    const normalizedMessages = normalizeDefaultMessageDrafts(messages);
    if (normalizedMessages.length === 0) {
      setNotice('至少保留一条提醒文案');
      return;
    }

    const saveVersion = defaultMessagesSaveVersionRef.current + 1;
    defaultMessagesSaveVersionRef.current = saveVersion;
    setDefaultMessagesSaving(true);
    setNotice('正在自动保存下班文案...');
    try {
      const savedMessages = await window.xiabanla.saveDefaultMessages(normalizedMessages);
      if (defaultMessagesSaveVersionRef.current !== saveVersion) {
        return;
      }
      if (options.replaceDraftsWithSaved) {
        setDefaultMessageDrafts(savedMessages);
      }
      setNotice(options.successNotice);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存下班文案失败');
    } finally {
      if (defaultMessagesSaveVersionRef.current === saveVersion) {
        setDefaultMessagesSaving(false);
      }
    }
  }

  async function resetDefaultMessageDrafts() {
    clearDefaultMessagesAutoSaveTimer();

    const saveVersion = defaultMessagesSaveVersionRef.current + 1;
    defaultMessagesSaveVersionRef.current = saveVersion;
    setDefaultMessagesSaving(true);
    setNotice('正在恢复默认下班文案...');
    try {
      const savedMessages = await window.xiabanla.resetDefaultMessages();
      if (defaultMessagesSaveVersionRef.current === saveVersion) {
        setDefaultMessageDrafts(savedMessages);
        setNotice('已恢复默认下班文案');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '恢复默认下班文案失败');
    } finally {
      if (defaultMessagesSaveVersionRef.current === saveVersion) {
        setDefaultMessagesSaving(false);
      }
    }
  }

  return {
    addDefaultMessageDraft,
    defaultMessageDrafts,
    defaultMessagesSaving,
    deleteDefaultMessageDraft,
    resetDefaultMessageDrafts,
    setDefaultMessageDrafts,
    updateDefaultMessageDraft
  };
}
