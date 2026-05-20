import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppFeatureFlags,
  DisplayInfo,
  MenuFloatingSurfaceKind,
  Reminder,
  ThemeMode
} from '../../../shared/types';
import {
  useAnimatedList,
  useListReorderMotion
} from '../../hooks/useMotion';
import { loadThemeMode, subscribeThemeMode } from '../../state/theme';
import { toDateKey } from '../../domain/dateTimeInput';
import {
  getHoveredReminderIdFromTarget
} from '../../domain/reminderDom';
import { isNewReminderDraftEdited } from '../../domain/reminderDraft';
import { compareRemindersForMenu } from '../../domain/reminderSort';
import { findOffWorkReminder } from '../../domain/reminderText';
import { getEventElement } from '../../utils/dom';
import {
  getElementAnchorRect,
  getSyntheticAnchorRect
} from '../floatingSurfaces/floatingSurfaceModel';
import type { ReminderExpansionMode } from '../reminders/reminderTypes';
import { useDefaultMessages } from './useDefaultMessages';
import { useDeleteUndo } from './useDeleteUndo';
import { MenuPanelView } from './MenuPanelView';
import { useMenuPanelRuntimeEffects } from './useMenuPanelRuntimeEffects';
import { useReminderPersistence } from './useReminderPersistence';
import { useOffWorkReminderDraft } from './useOffWorkReminderDraft';
import { useMenuFloatingState } from './useMenuFloatingState';
import { useReminderTitleDraft } from './useReminderTitleDraft';

const REMINDER_REORDER_ANIMATION_MS = 220;
const REMINDER_BLANK_CREATE_MENU_SUPPRESS_MS = 260;
const SYNCED_REMINDER_CONTEXT_MENU_HEIGHT = 86;
const DEFAULT_FEATURE_FLAGS: AppFeatureFlags = {
  externalSources: false
};

function getReminderKey(reminder: Reminder) {
  return reminder.id;
}

export function SettingsApp(props: { foregroundReminderActive?: boolean }) {
  const { foregroundReminderActive: foregroundReminderActiveProp = false } = props;
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [expandedId, setExpandedId] = useState<string>('');
  const [expandedMode, setExpandedMode] = useState<ReminderExpansionMode>('quick');
  const [featureFlags, setFeatureFlags] = useState<AppFeatureFlags>(DEFAULT_FEATURE_FLAGS);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [now, setNow] = useState(() => new Date());
  const [, setNotice] = useState('正在加载配置...');
  const {
    addDefaultMessageDraft,
    defaultMessageDrafts,
    defaultMessagesSaving,
    deleteDefaultMessageDraft,
    resetDefaultMessageDrafts,
    setDefaultMessageDrafts,
    updateDefaultMessageDraft
  } = useDefaultMessages(setNotice);
  const {
    deletePersistedReminder,
    refresh,
    reminders,
    remindersRef,
    saveReminder,
    setReminders
  } = useReminderPersistence({
    setDefaultMessageDrafts,
    setDisplays,
    setFeatureFlags,
    setNotice
  });
  const [menuPanelExiting, setMenuPanelExiting] = useState(false);
  const [nativeReminderOverlayVisible, setNativeReminderOverlayVisible] = useState(false);
  const {
    addReminderToUndoBatch,
    deleteUndoBatch,
    restoreDeletedReminders
  } = useDeleteUndo(setNotice);
  const [hoveredReminderId, setHoveredReminderId] = useState('');
  const expandedIdRef = useRef('');
  const suppressNextBlankCreateRef = useRef(false);
  const suppressBlankCreateUntilRef = useRef(0);
  const {
    activeFloatingSurface,
    activeFloatingSurfaceRef,
    clearFloatingSurfaceState,
    closeFloatingSurface,
    contextMenuStateRef,
    openFloatingSurface,
    setActiveFloatingSurface,
    toggleFloatingSurface,
    toggleFloatingSurfaceFromElement
  } = useMenuFloatingState({
    getMissingTitleReminderForInteraction,
    openTitleWarningMenu
  });
  const titleDraft = useReminderTitleDraft({
    displays,
    expandedIdRef,
    openFloatingSurface,
    remindersRef,
    saveReminder,
    setExpandedId,
    setExpandedMode,
    setNotice,
    suppressBlankCreateAfterMenuInteraction
  });
  const {
    newReminderDraft,
    newReminderDraftEditedRef,
    newReminderDraftInitialRef,
    newReminderDraftRef,
    restoreTitleWarningOnShowRef,
    setNewReminderDraft,
    titleWarningReminderIdRef
  } = titleDraft;
  const offWorkReminder = useMemo(() => findOffWorkReminder(reminders), [reminders]);
  const {
    addOffWorkReminder,
    cancelOffWorkDraft,
    collapseOffWorkExpandedCard,
    offWorkDraft,
    setOffWorkDraft,
    submitOffWorkDraft
  } = useOffWorkReminderDraft({
    blockOtherInteractionWhenReminderTitleMissing,
    displays,
    offWorkReminder,
    saveReminder,
    setExpandedId,
    setExpandedMode,
    setNotice
  });
  const displayedOffWorkReminder = offWorkDraft || offWorkReminder || null;
  const offWorkExpanded = Boolean(offWorkDraft || (offWorkReminder && expandedId === offWorkReminder.id));
  const currentDateKey = toDateKey(now);

  useEffect(() => {
    expandedIdRef.current = expandedId;
  }, [expandedId]);
  const moreReminders = useMemo(
    () => reminders
      .filter((reminder) => reminder.id !== offWorkReminder?.id)
      .sort((first, second) => compareRemindersForMenu(first, second, now)),
    [currentDateKey, offWorkReminder?.id, reminders]
  );
  const displayedMoreReminders = useMemo(
    () => (newReminderDraft ? [...moreReminders, newReminderDraft] : moreReminders),
    [newReminderDraft, moreReminders]
  );
  const newReminderDraftHasTitle = Boolean(newReminderDraft?.name.trim());
  const newReminderActionLabel = newReminderDraft
    ? (newReminderDraftHasTitle ? '保存新增提醒' : '取消新增提醒')
    : '添加';
  const newReminderButtonClassName = [
    'icon-button',
    'footer-icon-button',
    'primary-icon-button',
    newReminderDraft && !newReminderDraftHasTitle ? 'creating' : '',
    newReminderDraftHasTitle ? 'ready-to-save' : ''
  ].filter(Boolean).join(' ');
  const animatedMoreReminders = useAnimatedList(displayedMoreReminders, getReminderKey);
  const registerMoreReminderElement = useListReorderMotion(animatedMoreReminders, (item) => item.key, REMINDER_REORDER_ANIMATION_MS);
  const themeClassName = themeMode === 'system' ? '' : `theme-${themeMode}`;
  const menuShellClassName = ['menu-shell', themeClassName, menuPanelExiting ? 'menu-shell-exiting' : '']
    .filter(Boolean)
    .join(' ');
  const visibleOffWorkReminder = displayedOffWorkReminder && (displayedOffWorkReminder.enabled || offWorkExpanded)
    ? displayedOffWorkReminder
    : null;
  const hasVisibleOffWorkReminder = Boolean(visibleOffWorkReminder);
  const menuPanelClassName = [
    'menu-panel',
    offWorkExpanded ? 'off-work-expanded-panel' : '',
    hasVisibleOffWorkReminder ? '' : 'menu-panel-no-off-work'
  ].filter(Boolean).join(' ');
  const foregroundReminderActive = foregroundReminderActiveProp || nativeReminderOverlayVisible;

  useEffect(() => {
    return subscribeThemeMode(setThemeMode);
  }, []);

  useMenuPanelRuntimeEffects({
    activeFloatingSurfaceRef,
    cancelOffWorkDraft,
    clearFloatingSurfaceState,
    closeFloatingSurface,
    collapseOffWorkExpandedCard,
    deleteReminder,
    expandedId,
    expandedIdRef,
    finishQuickEdit,
    foregroundReminderActive,
    getMissingTitleReminderForInteraction,
    getReminderForTitleEdit,
    handleFloatingSurfaceClosed,
    newReminderDraft,
    newReminderDraftEditedRef,
    newReminderDraftInitialRef,
    newReminderDraftRef,
    offWorkDraft,
    offWorkExpanded,
    offWorkReminder,
    openSettingsMenu,
    openTitleWarningMenu,
    refresh,
    remindersRef,
    restoreTitleWarningOnShowRef,
    setActiveFloatingSurface,
    setExpandedId,
    setExpandedMode,
    setHoveredReminderId,
    setMenuPanelExiting,
    setNativeReminderOverlayVisible,
    setNewReminderDraft,
    setNotice,
    setNow,
    setOffWorkDraft,
    setReminders,
    shouldBlockMissingTitleEditExit,
    suppressNextBlankCreateRef,
    suppressTitleWarningOutsideClose,
    titleWarningReminderIdRef
  });

  function suppressBlankCreateAfterMenuInteraction() {
    suppressNextBlankCreateRef.current = true;
    suppressBlankCreateUntilRef.current = Date.now() + REMINDER_BLANK_CREATE_MENU_SUPPRESS_MS;
  }

  function suppressTitleWarningOutsideClose() {
    titleDraft.suppressTitleWarningOutsideClose();
  }

  function updateNewReminderDraft(reminder: Reminder, markEdited = true) {
    titleDraft.updateNewReminderDraft(reminder, markEdited);
  }

  function shouldBlockMissingTitleEditExit(reminder: Reminder) {
    return titleDraft.shouldBlockMissingTitleEditExit(reminder);
  }

  function getReminderForTitleEdit(reminderId: string) {
    return titleDraft.getReminderForTitleEdit(reminderId);
  }

  function getMissingTitleReminderForInteraction() {
    return titleDraft.getMissingTitleReminderForInteraction();
  }

  function blockOtherInteractionWhenReminderTitleMissing() {
    return titleDraft.blockOtherInteractionWhenReminderTitleMissing();
  }

  function finishReminderTitleEdit(reminder: Reminder, successNotice?: string) {
    return titleDraft.finishReminderTitleEdit(reminder, successNotice);
  }

  function openTitleWarningMenu(reminder: Reminder) {
    return titleDraft.openTitleWarningMenu(reminder);
  }

  function toggleNewReminderDraft() {
    titleDraft.toggleNewReminderDraft();
  }

  function finishQuickEdit(reminderId: string) {
    return titleDraft.finishQuickEdit(reminderId);
  }

  function commitQuickEdit(reminder: Reminder) {
    titleDraft.commitQuickEdit(reminder);
  }

  function returnReminderTitleEdit(reminderId: string) {
    return titleDraft.returnReminderTitleEdit(reminderId);
  }

  function consumePanelClickAfterTitleWarningClose(event: React.MouseEvent<HTMLElement>) {
    titleDraft.consumePanelClickAfterTitleWarningClose(event);
  }

  function prepareReminderBlankClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = getEventElement(event.target);
    if (!target) {
      return;
    }

    if (target.closest('.reminder-menu-item, button, input, select, textarea')) {
      return;
    }

    if (blockOtherInteractionWhenReminderTitleMissing()) {
      return;
    }

    if (!activeFloatingSurface && !expandedId && !newReminderDraft) {
      return;
    }

    suppressBlankCreateAfterMenuInteraction();
    if (expandedId && !finishQuickEdit(expandedId)) {
      return;
    }
    clearFloatingSurfaceState();
    void window.xiabanla.closeMenuFloatingSurface();
  }

  function createReminderFromBlankArea(event: React.MouseEvent<HTMLDivElement>) {
    const target = getEventElement(event.target);
    if (!target) {
      return;
    }

    if (target.closest('.reminder-menu-item, button, input, select, textarea')) {
      return;
    }

    if (
      suppressNextBlankCreateRef.current
      || Date.now() < suppressBlankCreateUntilRef.current
      || activeFloatingSurfaceRef.current
      || contextMenuStateRef.current
    ) {
      suppressNextBlankCreateRef.current = false;
      return;
    }

    titleDraft.addReminder();
  }

  function updateHoveredReminder(event: React.MouseEvent<HTMLDivElement>) {
    const nextHoveredReminderId = getHoveredReminderIdFromTarget(event.target);
    setHoveredReminderId((current) => (current === nextHoveredReminderId ? current : nextHoveredReminderId));
  }

  function openReminderQuickEdit(reminder: Reminder) {
    const missingTitleReminder = getMissingTitleReminderForInteraction();
    if (missingTitleReminder && missingTitleReminder.id !== reminder.id) {
      void openTitleWarningMenu(missingTitleReminder);
      return;
    }

    clearFloatingSurfaceState();
    void window.xiabanla.closeMenuFloatingSurface();
    if (expandedId === reminder.id && expandedMode === 'quick') {
      finishQuickEdit(reminder.id);
      return;
    }

    // 点击另一条更多提醒时，把当前编辑作为一次完整切换处理，避免全局失焦和条目点击分别抢状态。
    if (expandedId && expandedId !== reminder.id) {
      if (!finishQuickEdit(expandedId)) {
        return;
      }
    }

    titleDraft.rememberReminderTitleBeforeEdit(reminder);
    setExpandedMode('quick');
    setExpandedId(reminder.id);
  }

  async function deleteReminder(reminder: Reminder, successNotice = '已删除提醒') {
    if (newReminderDraft?.id === reminder.id) {
      newReminderDraftRef.current = null;
      newReminderDraftInitialRef.current = null;
      newReminderDraftEditedRef.current = false;
      titleDraft.clearReminderTitleEditSnapshot(reminder.id);
      setNewReminderDraft(null);
      await window.xiabanla.deleteDraftReminder(reminder.id);
      setExpandedId((current) => (current === reminder.id ? '' : current));
      setExpandedMode('quick');
      setNotice('已取消新增提醒');
      return;
    }
    setExpandedId((current) => (current === reminder.id ? '' : current));
    setExpandedMode('quick');
    addReminderToUndoBatch(reminder);
    await deletePersistedReminder(reminder, successNotice);
  }

  async function toggleExternalPanel(element: Element) {
    if (!featureFlags.externalSources) {
      return;
    }

    if (blockOtherInteractionWhenReminderTitleMissing()) {
      return;
    }

    await toggleFloatingSurfaceFromElement('external-sync', element, {
      placement: 'bottom-left'
    });
  }

  async function previewOffWorkReminder(reminder: Reminder) {
    try {
      const previewDetail = await window.xiabanla.triggerReminderPreview(reminder.id);
      if (!previewDetail) {
        setNotice('提醒不存在');
        return;
      }
      setNotice('已打开全屏提醒预览');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打开提醒预览失败');
    }
  }

  async function openReminderContextMenu(reminder: Reminder, event: React.MouseEvent, source: 'pointer' | 'info' = 'pointer') {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
    const anchorRect = source === 'info' && rect && target instanceof Element
      ? getElementAnchorRect(target)
      : getSyntheticAnchorRect(event.clientX, event.clientY);

    const blockingReminder = getMissingTitleReminderForInteraction();
    if (blockingReminder && blockingReminder.id !== reminder.id) {
      void openTitleWarningMenu(blockingReminder);
      return;
    }

    if (expandedIdRef.current === reminder.id) {
      const activeReminder = getReminderForTitleEdit(reminder.id);
      if (activeReminder && newReminderDraftRef.current?.id === reminder.id) {
        await window.xiabanla.saveDraftReminder(activeReminder);
      }
    } else if (expandedIdRef.current) {
      const activeReminderBeforeExit = getReminderForTitleEdit(expandedIdRef.current);
      // 菜单入口本身也是离开编辑态的意图：当前条目收起，其他条目先保存/取消当前编辑再打开菜单。
      if (!finishQuickEdit(expandedIdRef.current)) {
        return;
      }
      if (activeReminderBeforeExit?.id === reminder.id && !activeReminderBeforeExit.name.trim()) {
        return;
      }
    }

    void toggleFloatingSurface({
      kind: 'reminder-context',
      reminderId: reminder.id,
      anchorRect,
      placement: source === 'info' ? 'bottom-right' : 'bottom-left',
      preferredHeight: reminder.linkedExternalSource ? SYNCED_REMINDER_CONTEXT_MENU_HEIGHT : undefined
    });
  }

  function openSettingsMenu() {
    if (blockOtherInteractionWhenReminderTitleMissing()) {
      return Promise.resolve();
    }

    const settingsAnchor = document.querySelector('.settings-anchor button');
    if (!settingsAnchor) {
      return Promise.resolve();
    }
    return openFloatingSurface({
      kind: 'settings',
      anchorRect: getElementAnchorRect(settingsAnchor),
      placement: 'bottom-right'
    });
  }

  function handleFloatingSurfaceClosed(kind: MenuFloatingSurfaceKind) {
    const closedContextReminderId = kind === 'reminder-context'
      ? contextMenuStateRef.current?.reminderId
      : undefined;
    suppressBlankCreateAfterMenuInteraction();
    clearFloatingSurfaceState(kind);
    handleFloatingSurfaceCloseEffect(kind, closedContextReminderId);
  }

  function handleFloatingSurfaceCloseEffect(kind: MenuFloatingSurfaceKind, closedContextReminderId?: string) {
    switch (kind) {
      case 'reminder-context':
        void finishReminderTitleEditAfterContextClose(closedContextReminderId);
        break;
      case 'title-warning':
        void returnReminderTitleEdit(titleWarningReminderIdRef.current);
        break;
      default:
        break;
    }
  }

  async function finishReminderTitleEditAfterContextClose(reminderId?: string) {
    if (!reminderId) {
      return;
    }

    const latestDraft = await window.xiabanla.getDraftReminder(reminderId);
    if (latestDraft) {
      if (isNewReminderDraftEdited(latestDraft, newReminderDraftInitialRef.current)) {
        newReminderDraftEditedRef.current = true;
      }
      newReminderDraftRef.current = latestDraft;
      setNewReminderDraft(latestDraft);
      if (shouldBlockMissingTitleEditExit(latestDraft)) {
        await returnReminderTitleEdit(latestDraft.id);
        return;
      }
      finishReminderTitleEdit(latestDraft);
      return;
    }

    const latestReminders = await window.xiabanla.getReminders();
    const latestReminder = latestReminders.find((reminder) => reminder.id === reminderId);
    if (latestReminder && shouldBlockMissingTitleEditExit(latestReminder)) {
      await returnReminderTitleEdit(latestReminder.id);
      return;
    }
    if (latestReminder && expandedIdRef.current === reminderId) {
      finishReminderTitleEdit(latestReminder);
    }
  }

  function closeFloatingSurfaceFromPanelPointer(event: React.MouseEvent<HTMLElement>) {
    const target = getEventElement(event.target);
    if (activeFloatingSurfaceRef.current === 'title-warning') {
      // 关闭“未输入标题”提示后，同一次点击不能继续触发外部退出编辑，否则会立刻再次弹出提示。
      event.preventDefault();
      event.stopPropagation();
      suppressTitleWarningOutsideClose();
      void closeFloatingSurface('title-warning');
      return;
    }
    if (target?.closest('.floating-surface-toggle')) {
      return;
    }
    if (target?.closest('.context-menu')) {
      return;
    }

    if (activeFloatingSurfaceRef.current || contextMenuStateRef.current) {
      // 二级/三级菜单打开时，点击更多提醒空白处更像是在收起菜单，不应该顺手新建提醒。
      suppressBlankCreateAfterMenuInteraction();
    }
    const missingTitleReminder = getMissingTitleReminderForInteraction();
    if (
      missingTitleReminder
      && contextMenuStateRef.current?.reminderId === missingTitleReminder.id
    ) {
      void openTitleWarningMenu(missingTitleReminder);
      return;
    }
    void closeFloatingSurface();
  }

  return (
    <MenuPanelView
      activeFloatingSurface={activeFloatingSurface}
      animatedMoreReminders={animatedMoreReminders}
      defaultMessageDrafts={defaultMessageDrafts}
      defaultMessagesSaving={defaultMessagesSaving}
      deleteUndoBatch={deleteUndoBatch}
      displayedMoreRemindersLength={displayedMoreReminders.length}
      expandedId={expandedId}
      expandedMode={expandedMode}
      hasVisibleOffWorkReminder={hasVisibleOffWorkReminder}
      hoveredReminderId={hoveredReminderId}
      menuPanelClassName={menuPanelClassName}
      menuShellClassName={menuShellClassName}
      newReminderActionLabel={newReminderActionLabel}
      newReminderButtonClassName={newReminderButtonClassName}
      newReminderDraft={newReminderDraft}
      newReminderDraftHasTitle={newReminderDraftHasTitle}
      now={now}
      offWorkDraft={offWorkDraft}
      offWorkExpanded={offWorkExpanded}
      offWorkReminder={offWorkReminder}
      registerMoreReminderElement={registerMoreReminderElement}
      showExternalSync={featureFlags.externalSources}
      visibleOffWorkReminder={visibleOffWorkReminder}
      onAddDefaultMessage={addDefaultMessageDraft}
      onAddOffWorkReminder={addOffWorkReminder}
      onChangeOffWorkReminder={(nextReminder) => {
        if (offWorkDraft) {
          setOffWorkDraft(nextReminder);
          return;
        }
        void saveReminder(nextReminder);
      }}
      onChangeReminder={(nextReminder, isDraft) => {
        if (isDraft) {
          updateNewReminderDraft(nextReminder);
          return;
        }
        void saveReminder(nextReminder);
      }}
      onClickPanelAfterTitleWarningClose={consumePanelClickAfterTitleWarningClose}
      onCloseQuickEdit={(reminder) => finishQuickEdit(reminder.id)}
      onCollapseOffWork={collapseOffWorkExpandedCard}
      onCommitQuickEdit={commitQuickEdit}
      onDeleteDefaultMessage={deleteDefaultMessageDraft}
      onMouseDownPanel={(event) => {
        void window.xiabanla.keepMenuPanelOpen();
        closeFloatingSurfaceFromPanelPointer(event);
      }}
      onOpenReminderMenu={openReminderContextMenu}
      onOpenSettings={(element) => {
        void toggleFloatingSurfaceFromElement('settings', element, {
          placement: 'bottom-right'
        });
      }}
      onPrepareReminderBlankClick={prepareReminderBlankClick}
      onPreviewOffWorkReminder={(reminder) => void previewOffWorkReminder(reminder)}
      onQuickEdit={openReminderQuickEdit}
      onReminderBlankClick={createReminderFromBlankArea}
      onReminderHover={updateHoveredReminder}
      onReminderHoverLeave={() => setHoveredReminderId('')}
      onResetDefaultMessages={() => void resetDefaultMessageDrafts()}
      onRestoreDeletedReminders={() => void restoreDeletedReminders(saveReminder)}
      onSubmitOffWorkDraft={() => void submitOffWorkDraft()}
      onToggleExternalPanel={(element) => void toggleExternalPanel(element)}
      onToggleNewReminderDraft={toggleNewReminderDraft}
      onToggleOffWork={() => {
        if (blockOtherInteractionWhenReminderTitleMissing()) {
          return;
        }
        if (offWorkDraft) {
          cancelOffWorkDraft();
          return;
        }
        if (!visibleOffWorkReminder) {
          return;
        }
        setExpandedMode('full');
        setExpandedId((current) => (current === visibleOffWorkReminder.id ? '' : visibleOffWorkReminder.id));
      }}
      onUpdateDefaultMessage={updateDefaultMessageDraft}
    />
  );
}
