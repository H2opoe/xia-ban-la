import { useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_WORK_WEEK_DAYS, OFF_WORK_REMINDER_ID } from '../../../shared/reminderConstants';
import type { DisplayInfo, Reminder } from '../../../shared/types';
import { createReminder } from '../../domain/reminderFactory';
import type { ReminderExpansionMode } from '../reminders/reminderTypes';

type OffWorkReminderDraftOptions = {
  blockOtherInteractionWhenReminderTitleMissing: () => boolean;
  displays: DisplayInfo[];
  offWorkReminder?: Reminder;
  saveReminder: (reminder: Reminder, message?: string) => Promise<Reminder>;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setExpandedMode: Dispatch<SetStateAction<ReminderExpansionMode>>;
  setNotice: (notice: string) => void;
};

export function useOffWorkReminderDraft(options: OffWorkReminderDraftOptions) {
  const [offWorkDraft, setOffWorkDraft] = useState<Reminder | null>(null);

  async function addOffWorkReminder() {
    if (options.blockOtherInteractionWhenReminderTitleMissing()) {
      return;
    }

    if (options.offWorkReminder?.enabled) {
      options.setNotice('下班提醒已存在');
      return;
    }

    const primaryDisplay = options.displays.find((display) => display.isPrimary) || options.displays[0];
    const defaultMessages = await window.xiabanla.getDefaultMessages();
    const draft = {
      ...createReminder(primaryDisplay?.id, {
        id: OFF_WORK_REMINDER_ID,
        name: '下班提醒',
        repeatRule: 'weekdays',
        dailyTime: '18:00',
        alternateWeekDays: [...DEFAULT_WORK_WEEK_DAYS],
        alternateNextWeekDays: [...DEFAULT_WORK_WEEK_DAYS],
        messages: defaultMessages.length > 0 ? defaultMessages : undefined
      }),
      ...options.offWorkReminder,
      id: OFF_WORK_REMINDER_ID,
      name: options.offWorkReminder?.name || '下班提醒',
      enabled: true
    };
    setOffWorkDraft(draft);
    options.setExpandedId(OFF_WORK_REMINDER_ID);
    options.setExpandedMode('full');
    options.setNotice('请先配置下班提醒');
  }

  async function submitOffWorkDraft() {
    if (!offWorkDraft) {
      return;
    }

    const saved = await options.saveReminder(offWorkDraft, options.offWorkReminder ? '已恢复下班提醒' : '已添加下班提醒');
    setOffWorkDraft(null);
    options.setExpandedId(saved.id);
    options.setExpandedMode('full');
  }

  function collapseOffWorkExpandedCard() {
    setOffWorkDraft(null);
    options.setExpandedId('');
    options.setExpandedMode('quick');
  }

  function cancelOffWorkDraft() {
    collapseOffWorkExpandedCard();
    options.setNotice(options.offWorkReminder ? '已取消恢复下班提醒' : '已取消添加下班提醒');
  }

  return {
    addOffWorkReminder,
    cancelOffWorkDraft,
    collapseOffWorkExpandedCard,
    offWorkDraft,
    setOffWorkDraft,
    submitOffWorkDraft
  };
}
