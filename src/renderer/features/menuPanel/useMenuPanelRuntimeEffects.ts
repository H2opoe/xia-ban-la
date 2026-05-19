import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { OFF_WORK_REMINDER_ID } from '../../../shared/reminderConstants';
import type { MenuFloatingSurfaceKind, Reminder } from '../../../shared/types';
import { MENU_PANEL_ANIMATION_MS } from '../../../shared/window';
import { getHoveredReminderIdFromTarget } from '../../domain/reminderDom';
import { isNewReminderDraftEdited } from '../../domain/reminderDraft';
import { getEventElement } from '../../utils/dom';
import type { ReminderExpansionMode } from '../reminders/reminderTypes';

type RuntimeEffectDeps = {
  activeFloatingSurfaceRef: MutableRefObject<MenuFloatingSurfaceKind | null>;
  cancelOffWorkDraft: () => void;
  clearFloatingSurfaceState: (kind?: MenuFloatingSurfaceKind) => void;
  closeFloatingSurface: (kind?: MenuFloatingSurfaceKind) => Promise<void>;
  collapseOffWorkExpandedCard: () => void;
  deleteReminder: (reminder: Reminder) => Promise<void>;
  expandedId: string;
  finishQuickEdit: (reminderId: string) => boolean;
  foregroundReminderActive: boolean;
  getMissingTitleReminderForInteraction: () => Reminder | null;
  getReminderForTitleEdit: (reminderId: string) => Reminder | null;
  handleFloatingSurfaceClosed: (kind: MenuFloatingSurfaceKind) => void;
  newReminderDraft: Reminder | null;
  newReminderDraftEditedRef: MutableRefObject<boolean>;
  newReminderDraftInitialRef: MutableRefObject<Reminder | null>;
  newReminderDraftRef: MutableRefObject<Reminder | null>;
  offWorkDraft: Reminder | null;
  offWorkExpanded: boolean;
  offWorkReminder?: Reminder;
  openSettingsMenu: () => Promise<void>;
  openTitleWarningMenu: (reminder: Reminder) => Promise<void>;
  refresh: () => Promise<void>;
  remindersRef: MutableRefObject<Reminder[]>;
  restoreTitleWarningOnShowRef: MutableRefObject<boolean>;
  setActiveFloatingSurface: Dispatch<SetStateAction<MenuFloatingSurfaceKind | null>>;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setExpandedMode: Dispatch<SetStateAction<ReminderExpansionMode>>;
  setHoveredReminderId: Dispatch<SetStateAction<string>>;
  setMenuPanelExiting: Dispatch<SetStateAction<boolean>>;
  setNativeReminderOverlayVisible: Dispatch<SetStateAction<boolean>>;
  setNewReminderDraft: Dispatch<SetStateAction<Reminder | null>>;
  setNotice: (notice: string) => void;
  setNow: Dispatch<SetStateAction<Date>>;
  setOffWorkDraft: Dispatch<SetStateAction<Reminder | null>>;
  setReminders: Dispatch<SetStateAction<Reminder[]>>;
  shouldBlockMissingTitleEditExit: (reminder: Reminder) => boolean;
  suppressNextBlankCreateRef: MutableRefObject<boolean>;
  suppressTitleWarningOutsideClose: () => void;
  syncLinkedExternalReminders: (options?: { silent?: boolean }) => Promise<void>;
  titleWarningReminderIdRef: MutableRefObject<string>;
};

export function useMenuPanelRuntimeEffects(deps: RuntimeEffectDeps) {
  useEffect(() => {
    void deps.refresh();
    void deps.syncLinkedExternalReminders();
    const timer = window.setInterval(() => deps.setNow(new Date()), 1_000);
    const externalSyncTimer = window.setInterval(() => {
      void deps.syncLinkedExternalReminders({ silent: true });
    }, 60_000);
    const unsubscribe = window.xiabanla.onRemindersUpdated((nextReminders) => {
      deps.setReminders(nextReminders);
    });
    const unsubscribeReminderOverlayVisibility = window.xiabanla.onReminderOverlayVisibilityChanged((visible) => {
      deps.setNativeReminderOverlayVisible(visible);
    });
    const unsubscribeReminderDeleteRequested = window.xiabanla.onReminderDeleteRequested((id) => {
      const reminder = deps.remindersRef.current.find((item) => item.id === id);
      if (!reminder) {
        deps.setNotice('提醒不存在');
        return;
      }
      void deps.deleteReminder(reminder);
    });
    const unsubscribeDraftReminder = window.xiabanla.onDraftReminderUpdated((id, reminder) => {
      if (deps.newReminderDraftRef.current?.id !== id) {
        return;
      }
      if (reminder && isNewReminderDraftEdited(reminder, deps.newReminderDraftInitialRef.current)) {
        deps.newReminderDraftEditedRef.current = true;
      }
      deps.newReminderDraftRef.current = reminder;
      deps.setNewReminderDraft(reminder);
      if (!reminder) {
        deps.newReminderDraftEditedRef.current = false;
        deps.newReminderDraftInitialRef.current = null;
        deps.setExpandedId((current) => (current === id ? '' : current));
        deps.setExpandedMode('quick');
        deps.setNotice('已取消新增提醒');
      }
    });
    return () => {
      window.clearInterval(timer);
      window.clearInterval(externalSyncTimer);
      unsubscribe();
      unsubscribeReminderOverlayVisibility();
      unsubscribeReminderDeleteRequested();
      unsubscribeDraftReminder();
    };
  }, []);

  useEffect(() => {
    let resetTimer: number | null = null;
    let restoreWarningFrame: number | null = null;
    const clearResetTimer = () => {
      if (resetTimer === null) {
        return;
      }
      window.clearTimeout(resetTimer);
      resetTimer = null;
    };
    const clearRestoreWarningFrame = () => {
      if (restoreWarningFrame === null) {
        return;
      }
      window.cancelAnimationFrame(restoreWarningFrame);
      restoreWarningFrame = null;
    };
    const unsubscribeWillHide = window.xiabanla.onMenuPanelWillHide(() => {
      clearResetTimer();
      clearRestoreWarningFrame();
      deps.restoreTitleWarningOnShowRef.current = deps.activeFloatingSurfaceRef.current === 'title-warning';
      deps.setMenuPanelExiting(true);
      // 退回后台后再次打开面板应回到轻量收起态，避免保留上一次展开编辑现场。
      deps.collapseOffWorkExpandedCard();
      deps.clearFloatingSurfaceState();
      void window.xiabanla.closeMenuFloatingSurface();
      resetTimer = window.setTimeout(() => {
        deps.setMenuPanelExiting(false);
        resetTimer = null;
      }, MENU_PANEL_ANIMATION_MS + 80);
    });
    const unsubscribeDidShow = window.xiabanla.onMenuPanelDidShow(() => {
      clearResetTimer();
      deps.setMenuPanelExiting(false);
      if (deps.restoreTitleWarningOnShowRef.current) {
        deps.restoreTitleWarningOnShowRef.current = false;
        restoreWarningFrame = window.requestAnimationFrame(() => {
          restoreWarningFrame = null;
          const reminder = deps.getReminderForTitleEdit(deps.titleWarningReminderIdRef.current);
          if (reminder && deps.shouldBlockMissingTitleEditExit(reminder)) {
            void deps.openTitleWarningMenu(reminder);
          }
        });
      }
    });
    const unsubscribeOpenSettings = window.xiabanla.onMenuPanelOpenSettings(() => {
      clearResetTimer();
      clearRestoreWarningFrame();
      deps.restoreTitleWarningOnShowRef.current = false;
      deps.setMenuPanelExiting(false);
      deps.clearFloatingSurfaceState();
      deps.setOffWorkDraft(null);
      deps.setExpandedId('');
      deps.setExpandedMode('quick');
      void deps.openSettingsMenu();
    });
    const unsubscribeFloatingClosed = window.xiabanla.onMenuFloatingSurfaceClosed((kind) => {
      deps.handleFloatingSurfaceClosed(kind);
    });

    return () => {
      clearResetTimer();
      clearRestoreWarningFrame();
      unsubscribeWillHide();
      unsubscribeDidShow();
      unsubscribeOpenSettings();
      unsubscribeFloatingClosed();
    };
  }, []);

  useEffect(() => {
    function hidePanelFromTransparentArea(event: MouseEvent) {
      if (!document.body.classList.contains('menu-preview-route')) {
        return;
      }
      const target = getEventElement(event.target);
      if (target?.closest('.menu-shell')) {
        return;
      }
      if (target?.closest('.overlay')) {
        return;
      }
      if (deps.activeFloatingSurfaceRef.current === 'title-warning') {
        deps.suppressTitleWarningOutsideClose();
        void deps.closeFloatingSurface('title-warning');
        return;
      }
      const missingTitleReminder = deps.getMissingTitleReminderForInteraction();
      if (missingTitleReminder) {
        void deps.openTitleWarningMenu(missingTitleReminder);
        return;
      }
      void window.xiabanla.hideMenuPanel();
    }

    window.addEventListener('mousedown', hidePanelFromTransparentArea);
    return () => {
      window.removeEventListener('mousedown', hidePanelFromTransparentArea);
    };
  }, []);

  useEffect(() => {
    function updateHoveredReminderFromNativeEvent(event: MouseEvent) {
      deps.setHoveredReminderId((current) => {
        const nextHoveredReminderId = getHoveredReminderIdFromTarget(event.target);
        return current === nextHoveredReminderId ? current : nextHoveredReminderId;
      });
    }

    window.addEventListener('mouseover', updateHoveredReminderFromNativeEvent, true);
    window.addEventListener('mousemove', updateHoveredReminderFromNativeEvent, true);
    return () => {
      window.removeEventListener('mouseover', updateHoveredReminderFromNativeEvent, true);
      window.removeEventListener('mousemove', updateHoveredReminderFromNativeEvent, true);
    };
  }, []);

  useEffect(() => {
    if (deps.offWorkExpanded) {
      void window.xiabanla.closeMenuFloatingSurface('external-sync');
      deps.setActiveFloatingSurface((current) => (current === 'external-sync' ? null : current));
    }
  }, [deps.offWorkExpanded]);

  useEffect(() => {
    if (!deps.offWorkExpanded || deps.foregroundReminderActive) {
      return undefined;
    }

    function collapseOffWorkByEscape(event: KeyboardEvent) {
      if (event.repeat || event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      deps.collapseOffWorkExpandedCard();
    }

    window.addEventListener('keydown', collapseOffWorkByEscape);
    return () => {
      window.removeEventListener('keydown', collapseOffWorkByEscape);
    };
  }, [deps.foregroundReminderActive, deps.offWorkExpanded]);

  useEffect(() => {
    if (!deps.offWorkDraft || deps.foregroundReminderActive) {
      return undefined;
    }

    function cancelOffWorkDraftByOutsideClick(event: MouseEvent) {
      const target = getEventElement(event.target);
      if (!target) {
        return;
      }
      if (target.closest(`[data-reminder-id="${OFF_WORK_REMINDER_ID}"]`)) {
        return;
      }
      if (target.closest('.overlay')) {
        return;
      }
      if (target.closest('.quick-create-list')) {
        deps.suppressNextBlankCreateRef.current = true;
      }

      deps.cancelOffWorkDraft();
    }

    window.addEventListener('mousedown', cancelOffWorkDraftByOutsideClick);
    return () => {
      window.removeEventListener('mousedown', cancelOffWorkDraftByOutsideClick);
    };
  }, [deps.foregroundReminderActive, deps.offWorkDraft, deps.offWorkReminder]);

  useEffect(() => {
    if (!deps.expandedId) {
      return undefined;
    }

    function closeQuickEditByOutsideClick(event: MouseEvent) {
      const target = getEventElement(event.target);
      if (!target) {
        return;
      }
      const targetReminderItem = target.closest('.reminder-menu-item');
      if (targetReminderItem?.getAttribute('data-reminder-id') === deps.expandedId) {
        return;
      }
      if (target.closest('.task-info-button')) {
        return;
      }
      if (target.closest('.context-menu')) {
        return;
      }
      if (target.closest('[data-reminder-draft-action]')) {
        return;
      }
      if (target.closest('.overlay')) {
        return;
      }
      if (target.closest('.quick-create-list')) {
        deps.suppressNextBlankCreateRef.current = true;
      }
      const blockingReminder = deps.getMissingTitleReminderForInteraction();
      if (blockingReminder) {
        event.preventDefault();
        event.stopPropagation();
        void deps.openTitleWarningMenu(blockingReminder);
        return;
      }
      deps.finishQuickEdit(deps.expandedId);
    }

    window.addEventListener('mousedown', closeQuickEditByOutsideClick);
    return () => {
      window.removeEventListener('mousedown', closeQuickEditByOutsideClick);
    };
  }, [deps.expandedId, deps.newReminderDraft]);
}
