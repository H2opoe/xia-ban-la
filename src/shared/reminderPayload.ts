import type { Reminder, ReminderPayload } from './types.js';

type ReminderPayloadOverrides = Partial<Pick<ReminderPayload, 'title' | 'message'>>;

export function createReminderPayload(
  reminder: Reminder,
  now = new Date(),
  overrides: ReminderPayloadOverrides = {}
): ReminderPayload {
  return {
    reminderId: reminder.id,
    title: overrides.title || reminder.name,
    message: overrides.message || selectReminderMessage(reminder, '准备下班'),
    currentTime: formatReminderTime(now)
  };
}

export function selectRandomText(texts: string[], fallback: string) {
  const normalizedTexts = texts.map((text) => text.trim()).filter(Boolean);
  if (normalizedTexts.length === 0) {
    return fallback;
  }

  return normalizedTexts[Math.floor(Math.random() * normalizedTexts.length)] || fallback;
}

function selectReminderMessage(reminder: Reminder, fallback: string) {
  const enabledMessages = reminder.messages.filter((message) => message.enabled && message.text.trim());
  const messages = enabledMessages.length > 0 ? enabledMessages : reminder.messages.filter((message) => message.text.trim());
  return selectRandomText(messages.map((message) => message.text), fallback);
}

export function formatReminderTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
