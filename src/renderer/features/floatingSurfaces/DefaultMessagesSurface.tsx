import { useEffect, useState } from 'react';
import type { ReminderMessage } from '../../../shared/types';
import { createClientId } from '../../domain/reminderFactory';
import { FloatingMenuSurface } from './floatingSurfaceModel';

export function FloatingDefaultMessagesMenu() {
  const [messages, setMessages] = useState<ReminderMessage[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.xiabanla.getDefaultMessages().then(setMessages);
    const unsubscribe = window.xiabanla.onDefaultMessagesUpdated(setMessages);
    return unsubscribe;
  }, []);

  async function persist(nextMessages: ReminderMessage[]) {
    const normalizedMessages = nextMessages
      .map((message) => ({ ...message, text: message.text.trim() }))
      .filter((message) => message.text);
    if (normalizedMessages.length === 0) {
      return;
    }
    setSaving(true);
    try {
      const saved = await window.xiabanla.saveDefaultMessages(normalizedMessages);
      setMessages(saved);
    } finally {
      setSaving(false);
    }
  }

  function updateMessage(id: string, patch: Partial<ReminderMessage>) {
    setMessages((items) => items.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }

  function deleteMessage(id: string) {
    if (messages.length <= 1) {
      return;
    }
    const nextMessages = messages.filter((message) => message.id !== id);
    setMessages(nextMessages);
    void persist(nextMessages);
  }

  function addMessage() {
    setMessages((items) => [...items, { id: createClientId('message'), text: '', enabled: true }]);
  }

  return (
    <FloatingMenuSurface className="tertiary-submenu off-work-message-submenu">
      <div className="settings-message-list">
        {messages.map((message, index) => (
          <label className="settings-message-row" key={message.id}>
            <input type="checkbox" checked={message.enabled} aria-label={`启用文案 ${index + 1}`} onChange={(event) => updateMessage(message.id, { enabled: event.target.checked })} onBlur={() => void persist(messages)} />
            <input type="text" value={message.text} placeholder="准备下班" onChange={(event) => updateMessage(message.id, { text: event.target.value })} onBlur={() => void persist(messages)} />
            <button type="button" aria-label={`删除文案 ${index + 1}`} onClick={() => deleteMessage(message.id)}>删除</button>
          </label>
        ))}
      </div>
      <div className="settings-message-actions">
        <button type="button" onClick={addMessage}>新增</button>
        <button type="button" className="primary-card-action" disabled={saving} onClick={() => void window.xiabanla.resetDefaultMessages().then(setMessages)}>
          {saving ? '处理中' : '恢复默认'}
        </button>
      </div>
    </FloatingMenuSurface>
  );
}
