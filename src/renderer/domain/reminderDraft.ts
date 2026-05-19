import type { Reminder } from '../../shared/types';

export function isNewReminderDraftMeaningfullyConfigured(reminder: Reminder, initialReminder: Reminder | null) {
  if (!initialReminder) {
    return false;
  }

  return JSON.stringify(getDraftConfigurationSnapshot(reminder)) !== JSON.stringify(getDraftConfigurationSnapshot(initialReminder));
}

export function isNewReminderDraftEdited(reminder: Reminder, initialReminder: Reminder | null) {
  if (!initialReminder) {
    return false;
  }

  return reminder.name !== initialReminder.name || isNewReminderDraftMeaningfullyConfigured(reminder, initialReminder);
}

function getDraftConfigurationSnapshot(reminder: Reminder) {
  return {
    repeatRule: reminder.repeatRule,
    weeklyDays: [...(reminder.weeklyDays || [])],
    useAlternateWeeks: Boolean(reminder.useAlternateWeeks),
    alternateWeekAnchorDate: reminder.alternateWeekAnchorDate || '',
    alternateWeekDays: [...(reminder.alternateWeekDays || [])],
    alternateNextWeekDays: [...(reminder.alternateNextWeekDays || [])],
    scheduledDate: reminder.scheduledDate,
    dailyTime: reminder.dailyTime,
    advanceMinutes: reminder.advanceMinutes,
    repeatUntilDismissed: reminder.repeatUntilDismissed,
    repeatIntervalMinutes: reminder.repeatIntervalMinutes
  };
}
