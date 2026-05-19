import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  DisplayInfo,
  MenuFloatingSurfaceRequest,
  Reminder
} from '../../../shared/types';
import {
  nextHourTime,
  normalizeDateInput,
  normalizeTimeInput,
  toDateKey
} from '../../domain/dateTimeInput';
import {
  focusReminderTitleInput,
  getReminderMenuItemElement,
  getTitleWarningAnchorElement
} from '../../domain/reminderDom';
import {
  isNewReminderDraftEdited,
  isNewReminderDraftMeaningfullyConfigured
} from '../../domain/reminderDraft';
import { createReminder } from '../../domain/reminderFactory';
import { createDueDatePatch } from '../../domain/reminderText';
import { getElementAnchorRect } from '../floatingSurfaces/floatingSurfaceModel';
import type { ReminderExpansionMode } from '../reminders/reminderTypes';

type UseReminderTitleDraftOptions = {
  displays: DisplayInfo[];
  expandedIdRef: MutableRefObject<string>;
  openFloatingSurface: (request: MenuFloatingSurfaceRequest) => Promise<void>;
  remindersRef: MutableRefObject<Reminder[]>;
  saveReminder: (reminder: Reminder, successNotice?: string) => Promise<Reminder | void>;
  setExpandedId: (value: string | ((current: string) => string)) => void;
  setExpandedMode: (mode: ReminderExpansionMode) => void;
  setNotice: (notice: string) => void;
  suppressBlankCreateAfterMenuInteraction: () => void;
};

export function useReminderTitleDraft(options: UseReminderTitleDraftOptions) {
  const [newReminderDraft, setNewReminderDraft] = useState<Reminder | null>(null);
  const titleEditOriginalNamesRef = useRef(new Map<string, string>());
  const newReminderDraftRef = useRef<Reminder | null>(null);
  const newReminderDraftInitialRef = useRef<Reminder | null>(null);
  const newReminderDraftEditedRef = useRef(false);
  const suppressTitleWarningExitUntilRef = useRef(0);
  const restoreTitleWarningOnShowRef = useRef(false);
  const titleWarningReminderIdRef = useRef('');

  useEffect(() => {
    newReminderDraftRef.current = newReminderDraft;
  }, [newReminderDraft]);

  function addReminder() {
    if (newReminderDraft) {
      options.setExpandedId(newReminderDraft.id);
      options.setExpandedMode('quick');
      return;
    }

    const primaryDisplay = options.displays.find((display) => display.isPrimary) || options.displays[0];
    const reminder = createReminder(primaryDisplay?.id, {
      name: '',
      repeatRule: 'once',
      scheduledDate: toDateKey(new Date()),
      dailyTime: nextHourTime(new Date())
    });
    newReminderDraftInitialRef.current = reminder;
    newReminderDraftEditedRef.current = false;
    updateNewReminderDraft(reminder, false);
    options.setExpandedId(reminder.id);
    options.setExpandedMode('quick');
    options.setNotice('请输入标题');
  }

  function suppressTitleWarningOutsideClose() {
    options.suppressBlankCreateAfterMenuInteraction();
    suppressTitleWarningExitUntilRef.current = Date.now() + 260;
  }

  function isTitleWarningOutsideCloseSuppressed() {
    return Date.now() < suppressTitleWarningExitUntilRef.current;
  }

  function consumePanelClickAfterTitleWarningClose(event: React.MouseEvent<HTMLElement>) {
    if (!isTitleWarningOutsideCloseSuppressed()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressTitleWarningExitUntilRef.current = 0;
  }

  function updateNewReminderDraft(reminder: Reminder, markEdited = true) {
    if (markEdited) {
      newReminderDraftEditedRef.current = true;
    }
    newReminderDraftRef.current = reminder;
    setNewReminderDraft(reminder);
    void window.xiabanla.saveDraftReminder(reminder);
  }

  function shouldBlockMissingTitleEditExit(reminder: Reminder) {
    if (reminder.name.trim()) {
      return false;
    }

    if (newReminderDraftRef.current?.id === reminder.id) {
      return newReminderDraftEditedRef.current || isNewReminderDraftEdited(reminder, newReminderDraftInitialRef.current);
    }

    return options.remindersRef.current.some((item) => item.id === reminder.id);
  }

  function getReminderForTitleEdit(reminderId: string) {
    if (!reminderId) {
      return null;
    }
    if (newReminderDraftRef.current?.id === reminderId) {
      return syncFocusedNewReminderDraftQuickField(reminderId) || newReminderDraftRef.current;
    }

    return options.remindersRef.current.find((reminder) => reminder.id === reminderId) || null;
  }

  function getMissingTitleReminderForInteraction() {
    const activeDraft = newReminderDraftRef.current;
    if (activeDraft) {
      const syncedDraft = syncFocusedNewReminderDraftQuickField(activeDraft.id) || activeDraft;
      if (shouldBlockMissingTitleEditExit(syncedDraft)) {
        return syncedDraft;
      }
    }

    const expandedReminder = getReminderForTitleEdit(options.expandedIdRef.current);
    return expandedReminder && shouldBlockMissingTitleEditExit(expandedReminder) ? expandedReminder : null;
  }

  function rememberReminderTitleBeforeEdit(reminder: Reminder) {
    if (newReminderDraftRef.current?.id === reminder.id) {
      return;
    }
    if (!titleEditOriginalNamesRef.current.has(reminder.id)) {
      titleEditOriginalNamesRef.current.set(reminder.id, reminder.name);
    }
  }

  function clearReminderTitleEditSnapshot(reminderId: string) {
    titleEditOriginalNamesRef.current.delete(reminderId);
  }

  function getReminderTitleRestoreValue(reminder: Reminder) {
    if (newReminderDraftRef.current?.id === reminder.id) {
      return newReminderDraftInitialRef.current?.name || '';
    }
    return titleEditOriginalNamesRef.current.get(reminder.id) ?? reminder.name;
  }

  function blockOtherInteractionWhenReminderTitleMissing() {
    const reminder = getMissingTitleReminderForInteraction();
    if (!reminder) {
      return false;
    }

    void openTitleWarningMenu(reminder);
    return true;
  }

  function finishReminderTitleEdit(reminder: Reminder, successNotice = '已新增更多提醒') {
    const activeReminder = newReminderDraftRef.current?.id === reminder.id
      ? syncFocusedNewReminderDraftQuickField(reminder.id) || newReminderDraftRef.current || reminder
      : reminder;
    const isNewReminderDraft = newReminderDraftRef.current?.id === activeReminder.id;
    if (isTitleWarningOutsideCloseSuppressed()) {
      return false;
    }

    const name = activeReminder.name.trim();
    if (shouldBlockMissingTitleEditExit(activeReminder)) {
      void openTitleWarningMenu(activeReminder);
      return false;
    }

    if (isNewReminderDraft) {
      newReminderDraftRef.current = null;
      setNewReminderDraft(null);
      void window.xiabanla.deleteDraftReminder(activeReminder.id);
      newReminderDraftInitialRef.current = null;
      newReminderDraftEditedRef.current = false;
      if (!name) {
        options.expandedIdRef.current = '';
        options.setExpandedId('');
        options.setExpandedMode('quick');
        options.setNotice('已取消新增提醒');
        return true;
      }

      void options.saveReminder({ ...activeReminder, name }, successNotice);
    } else if (name !== activeReminder.name) {
      void options.saveReminder({ ...activeReminder, name });
    }

    clearReminderTitleEditSnapshot(activeReminder.id);
    options.expandedIdRef.current = '';
    options.setExpandedId('');
    options.setExpandedMode('quick');
    return true;
  }

  function syncFocusedNewReminderDraftQuickField(reminderId: string) {
    const activeDraft = newReminderDraftRef.current;
    if (!activeDraft || activeDraft.id !== reminderId) {
      return activeDraft;
    }

    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLInputElement)) {
      return activeDraft;
    }

    const reminderElement = getReminderMenuItemElement(reminderId);
    if (!reminderElement?.contains(activeElement)) {
      return activeDraft;
    }

    const fieldElement = activeElement.closest<HTMLElement>('.icon-field');
    if (!fieldElement) {
      return activeDraft;
    }

    let nextReminder: Reminder | null = null;
    if (fieldElement.querySelector('.date-icon')) {
      const normalizedDate = normalizeDateInput(activeElement.value);
      if (!normalizedDate) {
        return activeDraft;
      }
      nextReminder = { ...activeDraft, ...createDueDatePatch(activeDraft, normalizedDate) };
    }

    if (fieldElement.querySelector('.time-icon')) {
      const normalizedTime = normalizeTimeInput(activeElement.value);
      if (!normalizedTime) {
        return activeDraft;
      }
      nextReminder = { ...activeDraft, dailyTime: normalizedTime };
    }

    if (!nextReminder || !isNewReminderDraftMeaningfullyConfigured(nextReminder, activeDraft)) {
      return activeDraft;
    }

    // 日期输入在 blur 时才会提交；全局点击外部会先于 blur 执行，所以退出前需要同步当前输入框草稿。
    updateNewReminderDraft(nextReminder);
    return nextReminder;
  }

  async function openTitleWarningMenu(reminder: Reminder) {
    options.suppressBlankCreateAfterMenuInteraction();
    options.setExpandedId(reminder.id);
    options.setExpandedMode('quick');
    titleWarningReminderIdRef.current = reminder.id;
    const restoreTitle = getReminderTitleRestoreValue(reminder);
    if (newReminderDraftRef.current?.id === reminder.id) {
      newReminderDraftRef.current = reminder;
      await window.xiabanla.saveDraftReminder(reminder);
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    const anchorElement = getTitleWarningAnchorElement(reminder.id);
    if (!anchorElement) {
      options.setNotice('未输入标题');
      return;
    }

    await options.openFloatingSurface({
      kind: 'title-warning',
      reminderId: reminder.id,
      restoreTitle,
      anchorRect: getElementAnchorRect(anchorElement),
      placement: 'bottom-right'
    });
  }

  function cancelNewReminderDraft() {
    const activeDraft = newReminderDraftRef.current;
    if (!activeDraft) {
      return;
    }

    newReminderDraftRef.current = null;
    newReminderDraftInitialRef.current = null;
    newReminderDraftEditedRef.current = false;
    clearReminderTitleEditSnapshot(activeDraft.id);
    options.expandedIdRef.current = '';
    setNewReminderDraft(null);
    void window.xiabanla.deleteDraftReminder(activeDraft.id);
    options.setExpandedId((current) => (current === activeDraft.id ? '' : current));
    options.setExpandedMode('quick');
    options.setNotice('已取消新增提醒');
  }

  function toggleNewReminderDraft() {
    if (newReminderDraft) {
      const activeDraft = syncFocusedNewReminderDraftQuickField(newReminderDraft.id) || newReminderDraft;
      if (activeDraft.name.trim()) {
        finishReminderTitleEdit(activeDraft);
        return;
      }

      if (shouldBlockMissingTitleEditExit(activeDraft)) {
        void openTitleWarningMenu(activeDraft);
        return;
      }

      cancelNewReminderDraft();
      return;
    }

    addReminder();
  }

  function finishQuickEdit(reminderId: string) {
    const reminder = getReminderForTitleEdit(reminderId);
    if (reminder) {
      return finishReminderTitleEdit(reminder);
    }

    if (options.expandedIdRef.current === reminderId) {
      options.expandedIdRef.current = '';
    }
    options.setExpandedId((current) => (current === reminderId ? '' : current));
    options.setExpandedMode('quick');
    return true;
  }

  function commitQuickEdit(reminder: Reminder) {
    const currentReminder = newReminderDraftRef.current?.id === reminder.id
      ? syncFocusedNewReminderDraftQuickField(reminder.id) || newReminderDraftRef.current || reminder
      : reminder;
    finishReminderTitleEdit(currentReminder);
  }

  async function returnReminderTitleEdit(reminderId: string) {
    if (!reminderId) {
      return;
    }

    const draftReminder = await window.xiabanla.getDraftReminder(reminderId);
    const reminder = draftReminder || (await window.xiabanla.getReminders()).find((item) => item.id === reminderId) || null;
    if (!reminder || !shouldBlockMissingTitleEditExit(reminder)) {
      clearReminderTitleEditSnapshot(reminderId);
      if (options.expandedIdRef.current === reminderId) {
        options.expandedIdRef.current = '';
        options.setExpandedId('');
        options.setExpandedMode('quick');
      }
      return;
    }

    options.setExpandedId(reminderId);
    options.setExpandedMode('quick');
    focusReminderTitleInput(reminderId);
  }

  return {
    addReminder,
    blockOtherInteractionWhenReminderTitleMissing,
    cancelNewReminderDraft,
    clearReminderTitleEditSnapshot,
    commitQuickEdit,
    consumePanelClickAfterTitleWarningClose,
    finishQuickEdit,
    finishReminderTitleEdit,
    getMissingTitleReminderForInteraction,
    getReminderForTitleEdit,
    isTitleWarningOutsideCloseSuppressed,
    newReminderDraft,
    newReminderDraftEditedRef,
    newReminderDraftInitialRef,
    newReminderDraftRef,
    openTitleWarningMenu,
    rememberReminderTitleBeforeEdit,
    returnReminderTitleEdit,
    restoreTitleWarningOnShowRef,
    setNewReminderDraft,
    shouldBlockMissingTitleEditExit,
    suppressTitleWarningOutsideClose,
    syncFocusedNewReminderDraftQuickField,
    titleWarningReminderIdRef,
    toggleNewReminderDraft,
    updateNewReminderDraft
  };
}
