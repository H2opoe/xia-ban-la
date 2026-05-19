import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getExternalAccessInstruction } from '../shared/externalAccessMessages';
import { createExternalReminderPatch, getExternalEventLinkKeys, getExternalSourceLinkKeys } from '../shared/externalReminder';
import { getAlternateWeekCycleSlot, getAlternateWeekDays, getReminderDueDateKey, getReminderNextDateKey, shouldReminderRunOnDate } from '../shared/reminderSchedule';
import type {
  AppAboutInfo,
  DisplayInfo,
  ExternalAccessKind,
  ExternalEvent,
  ExternalSourceAccess,
  MenuFloatingSurfaceKind,
  MenuFloatingSurfaceRequest,
  Reminder,
  ReminderMessage,
  ReminderPayload,
  RepeatRule,
  ThemeMode
} from '../shared/types';
import {
  MENU_PANEL_ANIMATION_MS,
  MENU_PANEL_SIZE,
  MENU_SURFACE_OUTSET
} from '../shared/window';
import './styles.css';

const THEME_STORAGE_KEY = 'xiabanla.themeMode';
const THEME_MODE_CHANGED_EVENT = 'xiabanla:theme-mode-changed';
const THEME_BROADCAST_CHANNEL = 'xiabanla:theme-mode';

const WEEK_DAYS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 }
];
const DEFAULT_WORK_WEEK_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_NEW_REMINDER_NAME = '新提醒';
const DEFAULT_APP_ABOUT_INFO: AppAboutInfo = {
  version: '0.1.0',
  currentYear: new Date().getFullYear()
};
type ReminderContextMenuState = {
  reminderId: string;
};
type SettingsMenuState = {
  autoLaunch: boolean;
  lockScreenAfterIdle: boolean;
  selectedDisplayIds: string[];
  themeMode: ThemeMode;
  displays: DisplayInfo[];
  aboutInfo: AppAboutInfo;
};

const OFF_WORK_REMINDER_ID = 'default-off-work';
type ReminderExpansionMode = 'quick' | 'full';
type ExternalPanelTab = 'calendar' | 'reminders';
const DEFAULT_MESSAGE_AUTO_SAVE_DELAY_MS = 500;
const DELETE_UNDO_TIMEOUT_MS = 5_000;
const REMINDER_REORDER_ANIMATION_MS = 220;
const HOVER_SUBMENU_CLOSE_DELAY_MS = 220;
const REMINDER_BLANK_CREATE_MENU_SUPPRESS_MS = 260;
const CONTEXT_MENU_POINTER_GAP = 8;
const SYNCED_REMINDER_CONTEXT_MENU_HEIGHT = 86;
const SETTINGS_TERTIARY_MENU_WIDTH = 210;
const SETTINGS_THEME_MENU_WIDTH = 105;
const SETTINGS_ABOUT_MENU_MIN_WIDTH = SETTINGS_TERTIARY_MENU_WIDTH;
const SETTINGS_ABOUT_MENU_MAX_WIDTH = 520;
const SETTINGS_ABOUT_MENU_HORIZONTAL_PADDING = 20;
const FLOATING_SURFACE_KEEP_OPEN_THROTTLE_MS = 120;
const FLOATING_SUBMENU_KINDS: MenuFloatingSurfaceKind[] = [
  'settings-display',
  'settings-lock-screen',
  'settings-theme',
  'settings-about',
  'reminder-date',
  'reminder-repeat',
  'today-override',
  'default-messages'
];
let lastFloatingSubmenuCloseAt = 0;
let lastFloatingSurfaceKeepOpenAt = 0;
type PresencePhase = 'enter' | 'exit';
type ListPresencePhase = PresencePhase | 'idle';
type PresenceState<T> = {
  value: T | null;
  phase: PresencePhase;
};
type AnimatedListItem<T> = {
  key: string;
  item: T;
  phase: ListPresencePhase;
};
type DeleteUndoBatch = {
  reminders: Reminder[];
  version: number;
} | null;

function isInputMethodComposing(event: React.KeyboardEvent<HTMLElement>) {
  return event.nativeEvent.isComposing;
}

function useInputMethodGuard() {
  const isComposingRef = useRef(false);
  const justFinishedComposingRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  function clearResetTimer() {
    if (resetTimerRef.current === null) {
      return;
    }
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }

  function markCompositionStart() {
    clearResetTimer();
    isComposingRef.current = true;
    justFinishedComposingRef.current = false;
  }

  function markCompositionEnd() {
    clearResetTimer();
    isComposingRef.current = false;
    justFinishedComposingRef.current = true;
    // 只兜住少数环境里 compositionend 先于 Enter keydown 的同一轮事件，避免误吃用户下一次保存。
    resetTimerRef.current = window.setTimeout(() => {
      justFinishedComposingRef.current = false;
      resetTimerRef.current = null;
    }, 0);
  }

  function shouldIgnoreEnter(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter') {
      return false;
    }

    const isComposing = isInputMethodComposing(event) || isComposingRef.current;
    const justFinishedComposing = justFinishedComposingRef.current;

    if (!isComposing && !justFinishedComposing) {
      return false;
    }

    isComposingRef.current = false;
    justFinishedComposingRef.current = false;
    return true;
  }

  return {
    markCompositionStart,
    markCompositionEnd,
    shouldIgnoreEnter
  };
}

function useReminderQuickDismiss(enabled: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || (event.key !== 'Escape' && event.key !== 'Enter')) {
        return;
      }
      // Esc 是全屏提醒的兜底关闭入口，即使焦点在自定义稍后输入框里也要生效。
      if (event.key === 'Enter' && shouldKeepReminderKeyboardEventInField(event.target)) {
        return;
      }

      event.preventDefault();
      onDismiss();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onDismiss]);
}

function shouldKeepReminderKeyboardEventInField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function getEventElement(target: EventTarget | null) {
  return target instanceof Element ? target : null;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function Presence(props: { visible: boolean; children: (phase: PresencePhase) => React.ReactNode }) {
  const { visible, children } = props;
  const state = usePresenceValue(visible ? true : null);

  if (!state.value) {
    return null;
  }

  return <>{children(state.phase)}</>;
}

function usePresenceValue<T>(value: T | null, durationMs = MENU_PANEL_ANIMATION_MS): PresenceState<T> {
  const [state, setState] = useState<PresenceState<T>>({
    value,
    phase: 'enter'
  });

  useEffect(() => {
    if (value) {
      setState({ value, phase: 'enter' });
      return undefined;
    }

    if (!state.value) {
      return undefined;
    }

    setState((current) => (current.value ? { ...current, phase: 'exit' } : current));
    const timer = window.setTimeout(() => {
      setState((current) => (current.phase === 'exit' ? { value: null, phase: 'enter' } : current));
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [durationMs, state.value, value]);

  return state;
}

function useAnimatedList<T>(
  items: T[],
  getKey: (item: T) => string,
  durationMs = MENU_PANEL_ANIMATION_MS
): AnimatedListItem<T>[] {
  const [animatedItems, setAnimatedItems] = useState<AnimatedListItem<T>[]>(() =>
    items.map((item) => ({
      key: getKey(item),
      item,
      phase: 'enter'
    }))
  );

  useEffect(() => {
    setAnimatedItems((currentItems) => {
      const nextItemsByKey = new Map(items.map((item) => [getKey(item), item]));
      const currentItemsByKey = new Map(currentItems.map((item) => [item.key, item]));
      const enteringItems: AnimatedListItem<T>[] = items.map((item) => {
        const key = getKey(item);
        const currentPhase = currentItemsByKey.get(key)?.phase;
        return {
          key,
          item,
          phase: currentPhase === 'exit' ? 'enter' : (currentPhase || 'enter')
        };
      });
      const nextAnimatedItems = [...enteringItems];

      currentItems.forEach((currentItem, index) => {
        if (nextItemsByKey.has(currentItem.key)) {
          return;
        }

        nextAnimatedItems.splice(Math.min(index, nextAnimatedItems.length), 0, {
          ...currentItem,
          phase: 'exit'
        });
      });

      return nextAnimatedItems;
    });
  }, [getKey, items]);

  useEffect(() => {
    if (!animatedItems.some((item) => item.phase === 'exit')) {
      return undefined;
    }

    const sourceKeys = new Set(items.map((item) => getKey(item)));
    const timer = window.setTimeout(() => {
      setAnimatedItems((currentItems) => currentItems.filter((item) => item.phase !== 'exit' || sourceKeys.has(item.key)));
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [animatedItems, durationMs, getKey, items]);

  useEffect(() => {
    if (!animatedItems.some((item) => item.phase === 'enter')) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setAnimatedItems((currentItems) =>
        currentItems.map((item) => (item.phase === 'enter' ? { ...item, phase: 'idle' } : item))
      );
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [animatedItems, durationMs]);

  return animatedItems;
}

function useListReorderMotion<T>(
  items: T[],
  getKey: (item: T) => string,
  durationMs = REMINDER_REORDER_ANIMATION_MS
) {
  const elementRefs = useRef(new Map<string, HTMLElement>());
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const previousOrderRef = useRef<string[]>([]);
  const activeAnimationsRef = useRef(new Map<string, Animation>());
  const orderSignature = items.map((item) => getKey(item)).join('|');

  useLayoutEffect(() => {
    const previousOrder = previousOrderRef.current;
    const nextOrder = items.map((item) => getKey(item));
    const shouldAnimateReorder = hasSameKeys(previousOrder, nextOrder) && previousOrder.join('|') !== orderSignature;
    const nextRects = new Map<string, DOMRect>();

    items.forEach((item) => {
      const key = getKey(item);
      const element = elementRefs.current.get(key);
      if (!element) {
        return;
      }

      const nextRect = element.getBoundingClientRect();
      const previousRect = previousRectsRef.current.get(key);
      nextRects.set(key, nextRect);

      if (!shouldAnimateReorder || !previousRect) {
        return;
      }

      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) {
        return;
      }

      // 完成提醒会触发排序变化，用 FLIP 位移动画承接旧位置到新位置，避免列表硬切。
      activeAnimationsRef.current.get(key)?.cancel();
      element.classList.add('reminder-menu-item-reordering');
      const animation = element.animate([
        { transform: `translateY(${deltaY}px)` },
        { transform: 'translateY(0)' }
      ], {
        duration: durationMs,
        easing: 'cubic-bezier(0.2, 0.85, 0.2, 1)'
      });

      activeAnimationsRef.current.set(key, animation);
      animation.addEventListener('finish', () => {
        if (activeAnimationsRef.current.get(key) !== animation) {
          return;
        }
        activeAnimationsRef.current.delete(key);
        element.classList.remove('reminder-menu-item-reordering');
      }, { once: true });
      animation.addEventListener('cancel', () => {
        if (activeAnimationsRef.current.get(key) === animation) {
          activeAnimationsRef.current.delete(key);
        }
        element.classList.remove('reminder-menu-item-reordering');
      }, { once: true });
    });

    previousRectsRef.current = nextRects;
    previousOrderRef.current = nextOrder;
  }, [durationMs, getKey, items, orderSignature]);

  return useCallback((key: string, element: HTMLElement | null) => {
    if (!element) {
      activeAnimationsRef.current.get(key)?.cancel();
      activeAnimationsRef.current.delete(key);
      elementRefs.current.delete(key);
      return;
    }
    elementRefs.current.set(key, element);
  }, []);
}

function useHoverSubmenu<T>() {
  const [activeSubmenu, setActiveSubmenu] = useState<T | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  function cancelClose() {
    if (closeTimerRef.current === null) {
      return;
    }
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function openSubmenu(nextSubmenu: T) {
    cancelClose();
    setActiveSubmenu(nextSubmenu);
  }

  function scheduleClose() {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setActiveSubmenu(null);
      closeTimerRef.current = null;
    }, HOVER_SUBMENU_CLOSE_DELAY_MS);
  }

  function closeSubmenu() {
    cancelClose();
    setActiveSubmenu(null);
  }

  return {
    activeSubmenu,
    openSubmenu,
    scheduleClose,
    cancelClose,
    closeSubmenu
  };
}

function getReminderKey(reminder: Reminder) {
  return reminder.id;
}

function hasSameKeys(first: string[], second: string[]) {
  if (first.length === 0 || first.length !== second.length) {
    return false;
  }

  const firstKeys = new Set(first);
  return second.every((key) => firstKeys.has(key));
}

function getMotionClassName(className: string, phase: PresencePhase, extraClassName?: string) {
  return [className, extraClassName, 'motion-presence', `motion-${phase}`].filter(Boolean).join(' ');
}

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function getListMotionClassName(className: string, phase: ListPresencePhase, extraClassName?: string) {
  if (phase === 'idle') {
    return [className, extraClassName].filter(Boolean).join(' ');
  }

  return getMotionClassName(className, phase, extraClassName);
}

function App() {
  const [routeHash, setRouteHash] = useState(() => window.location.hash);
  const isReminderRoute = routeHash === '#/reminder';
  const floatingRoute = getFloatingRoute(routeHash);

  useEffect(() => {
    function updateRouteHash() {
      setRouteHash(window.location.hash);
    }

    window.addEventListener('hashchange', updateRouteHash);
    return () => window.removeEventListener('hashchange', updateRouteHash);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('menu-preview-route', !isReminderRoute && !floatingRoute);
    document.body.classList.toggle('menu-floating-route', Boolean(floatingRoute));
    document.body.style.setProperty('--menu-panel-width', `${MENU_PANEL_SIZE.width}px`);
    document.body.style.setProperty('--menu-panel-height', `${MENU_PANEL_SIZE.height}px`);
    document.body.style.setProperty('--surface-outset', `${MENU_SURFACE_OUTSET}px`);

    return () => {
      document.body.classList.remove('menu-preview-route');
      document.body.classList.remove('menu-floating-route');
      document.body.style.removeProperty('--menu-panel-width');
      document.body.style.removeProperty('--menu-panel-height');
      document.body.style.removeProperty('--surface-outset');
    };
  }, [floatingRoute, isReminderRoute]);

  if (isReminderRoute) {
    return <ReminderOverlay />;
  }

  if (floatingRoute) {
    return <FloatingSurfaceApp route={floatingRoute} />;
  }

  return <SettingsApp />;
}

type FloatingRoute = {
  kind: MenuFloatingSurfaceKind;
  reminderId?: string;
  restoreTitle?: string;
};

function getFloatingRoute(routeHash: string): FloatingRoute | null {
  const match = /^#\/floating\/([^?]+)(?:\?(.*))?$/.exec(routeHash);
  if (!match) {
    return null;
  }

  const kind = match[1] as MenuFloatingSurfaceKind;
  const params = new URLSearchParams(match[2] || '');
  return {
    kind,
    reminderId: params.get('reminderId') || undefined,
    restoreTitle: params.get('restoreTitle') ?? undefined
  };
}

function getElementAnchorRect(element: Element): MenuFloatingSurfaceRequest['anchorRect'] {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function getSyntheticAnchorRect(x: number, y: number): MenuFloatingSurfaceRequest['anchorRect'] {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: 1,
    height: 1
  };
}

function openFloatingSurfaceFromElement(
  kind: MenuFloatingSurfaceKind,
  element: Element,
  options: Omit<MenuFloatingSurfaceRequest, 'kind' | 'anchorRect'> = {}
) {
  return window.xiabanla.openMenuFloatingSurface({
    kind,
    anchorRect: getElementAnchorRect(element),
    ...options
  });
}

function useFloatingSubmenu() {
  const [activeNestedKind, setActiveNestedKind] = useState<MenuFloatingSurfaceKind | null>(null);
  const activeNestedKindRef = useRef<MenuFloatingSurfaceKind | null>(null);

  useEffect(() => window.xiabanla.onMenuFloatingSurfaceClosed((kind) => {
    if (activeNestedKindRef.current === kind) {
      activeNestedKindRef.current = null;
      setActiveNestedKind(null);
    }
  }), []);

  const openSubmenu = useCallback((
    kind: MenuFloatingSurfaceKind,
    event: React.SyntheticEvent<HTMLElement>,
    options: Omit<MenuFloatingSurfaceRequest, 'kind' | 'anchorRect'> = {}
  ) => {
    if (activeNestedKindRef.current === kind) {
      void window.xiabanla.keepMenuPanelOpen();
      return;
    }

    const target = event.currentTarget;
    activeNestedKindRef.current = kind;
    setActiveNestedKind(kind);
    void window.xiabanla.keepMenuPanelOpen();
    void openFloatingSurfaceFromElement(kind, target, options);
  }, []);

  const closeSubmenu = useCallback((kind?: MenuFloatingSurfaceKind) => {
    if (!kind || activeNestedKindRef.current === kind) {
      activeNestedKindRef.current = null;
      setActiveNestedKind(null);
    }

    closeFloatingSubmenus(kind);
  }, []);

  return { activeNestedKind, openSubmenu, closeSubmenu };
}

function closeFloatingSubmenus(kind?: MenuFloatingSurfaceKind) {
  const now = Date.now();
  if (now - lastFloatingSubmenuCloseAt < 120) {
    return;
  }

  lastFloatingSubmenuCloseAt = now;
  const targetKinds = kind ? [kind] : FLOATING_SUBMENU_KINDS;
  targetKinds.forEach((targetKind) => {
    void window.xiabanla.closeMenuFloatingSurface(targetKind);
  });
}

function closeFloatingSubmenusFromParentPointer(
  event: React.MouseEvent<HTMLElement>,
  closeSubmenu?: (kind?: MenuFloatingSurfaceKind) => void
) {
  const target = getEventElement(event.target);
  if (target?.closest('.floating-menu-group, .floating-menu-parent, .compact-menu-row')) {
    return;
  }
  if (target === event.currentTarget) {
    // 跨 BrowserWindow 进入三级菜单时会经过二级菜单边缘，边缘空白只保持菜单活跃，关闭交给主进程按窗口边界判断。
    keepFloatingSurfaceInteractionActive();
    return;
  }

  if (closeSubmenu) {
    closeSubmenu();
    return;
  }

  closeFloatingSubmenus();
}

function keepFloatingSurfaceInteractionActive() {
  const now = Date.now();
  if (now - lastFloatingSurfaceKeepOpenAt < FLOATING_SURFACE_KEEP_OPEN_THROTTLE_MS) {
    return;
  }

  lastFloatingSurfaceKeepOpenAt = now;
  void window.xiabanla.keepMenuPanelOpen();
}

function syncHoveredFloatingMenuRow(event: React.MouseEvent<HTMLElement>) {
  const surface = event.currentTarget;
  const target = getEventElement(event.target);
  const hoveredRow = target?.closest<HTMLElement>('.floating-menu-row, .compact-menu-row');

  surface.querySelectorAll('.floating-menu-row-hovered').forEach((row) => {
    if (row !== hoveredRow) {
      row.classList.remove('floating-menu-row-hovered');
    }
  });

  if (hoveredRow && surface.contains(hoveredRow)) {
    hoveredRow.classList.add('floating-menu-row-hovered');
  }
}

function clearHoveredFloatingMenuRow(event: React.MouseEvent<HTMLElement>) {
  event.currentTarget.querySelectorAll('.floating-menu-row-hovered').forEach((row) => {
    row.classList.remove('floating-menu-row-hovered');
  });
}

function FloatingMenuSurface(props: React.PropsWithChildren<{
  className?: string;
  role?: React.AriaRole;
  id?: string;
}>) {
  const { className = '', role, id, children } = props;
  return (
    <section
      id={id}
      role={role}
      className={['floating-menu-surface', 'is-open', 'floating-surface-fill', className].filter(Boolean).join(' ')}
      onPointerDownCapture={keepFloatingSurfaceInteractionActive}
      onMouseMove={syncHoveredFloatingMenuRow}
      onMouseLeave={clearHoveredFloatingMenuRow}
      onScrollCapture={keepFloatingSurfaceInteractionActive}
      onWheelCapture={(event) => {
        keepFloatingSurfaceInteractionActive();
        event.stopPropagation();
      }}
    >
      {children}
    </section>
  );
}

function ReminderContextMenu(props: {
  reminder: Reminder;
  className?: string;
  style?: React.CSSProperties;
  onClose: () => void;
  onSaveReminder?: (reminder: Reminder) => Promise<Reminder> | Reminder;
  onRequestDelete?: (reminder: Reminder) => Promise<void> | void;
}) {
  const {
    reminder: initialReminder,
    className = 'context-menu',
    style,
    onClose,
    onSaveReminder,
    onRequestDelete
  } = props;
  const [reminder, setReminder] = useState<Reminder>(initialReminder);
  const { activeNestedKind, openSubmenu, closeSubmenu } = useFloatingSubmenu();

  useEffect(() => {
    setReminder(initialReminder);
  }, [initialReminder]);

  async function savePatch(patch: Partial<Reminder>, close = true) {
    const nextReminder = { ...reminder, ...patch };
    const savedReminder = onSaveReminder
      ? await onSaveReminder(nextReminder)
      : await window.xiabanla.saveReminder(nextReminder);
    setReminder(savedReminder);
    if (close) {
      onClose();
    }
  }

  async function deleteCurrentReminder() {
    if (onRequestDelete) {
      await onRequestDelete(reminder);
    } else {
      await window.xiabanla.requestReminderDelete(reminder.id);
    }
    onClose();
  }

  function openDateSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSubmenu('reminder-date', event, { reminderId: reminder.id, placement: 'right-top' });
  }

  function openRepeatSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSubmenu('reminder-repeat', event, { reminderId: reminder.id, placement: 'right-top' });
  }

  const isExternalSynced = Boolean(reminder.linkedExternalSource);
  return (
    <section
      className={['floating-menu-surface', 'is-open', className].filter(Boolean).join(' ')}
      style={style}
      onMouseMove={(event) => {
        syncHoveredFloatingMenuRow(event);
        closeFloatingSubmenusFromParentPointer(event, closeSubmenu);
      }}
      onMouseLeave={clearHoveredFloatingMenuRow}
    >
      {!isExternalSynced && (
        <button className="floating-menu-row" type="button" role="menuitem" onClick={() => void savePatch(createCompletionPatch(reminder))}>
          {reminder.completed ? '标为未完成' : '标为完成'}
        </button>
      )}
      {!isExternalSynced && (
        <div
          className={['floating-menu-group context-menu-group', activeNestedKind === 'reminder-date' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
          role="menuitem"
          tabIndex={0}
          onPointerEnter={openDateSubmenu}
          onMouseMove={openDateSubmenu}
          onFocus={openDateSubmenu}
        >
          <button
            className="floating-menu-row floating-menu-parent context-menu-parent"
            type="button"
            onClick={openDateSubmenu}
          >
            <span>截止日期</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {!isExternalSynced && (
        <label className="floating-menu-row context-time-row">
          <span>截止时间</span>
          <TimeField
            value={reminder.dailyTime}
            onChange={(dailyTime) => savePatch({ dailyTime }, false)}
            onKeyboardCommit={onClose}
          />
        </label>
      )}
      {!isExternalSynced && (
        <div
          className={['floating-menu-group context-menu-group', activeNestedKind === 'reminder-repeat' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
          role="menuitem"
          tabIndex={0}
          onPointerEnter={openRepeatSubmenu}
          onMouseMove={openRepeatSubmenu}
          onFocus={openRepeatSubmenu}
        >
          <button
            className="floating-menu-row floating-menu-parent context-menu-parent"
            type="button"
            onClick={openRepeatSubmenu}
          >
            <span>重复</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      <button className="floating-menu-row context-danger" type="button" onClick={() => void deleteCurrentReminder()}>
        {isExternalSynced ? '取消同步' : '删除'}
      </button>
      {isExternalSynced && <div className="context-readonly-hint">该提醒同步自本机日历或提醒事项，请到对应软件内修改。</div>}
    </section>
  );
}

function SettingsPopover(props: {
  state: SettingsMenuState;
  className?: string;
  onAutoLaunchChange: (enabled: boolean) => void;
  onLockScreenAfterIdleChange: (enabled: boolean) => void;
  onThemeModeChange: (themeMode: ThemeMode) => void;
}) {
  const {
    state,
    className = 'settings-popover',
    onAutoLaunchChange,
    onLockScreenAfterIdleChange,
    onThemeModeChange
  } = props;
  const [autoLaunch, setAutoLaunch] = useState(state.autoLaunch);
  const [lockScreenAfterIdle, setLockScreenAfterIdle] = useState(state.lockScreenAfterIdle);
  const [selectedDisplayIds, setSelectedDisplayIds] = useState(state.selectedDisplayIds);
  const [themeMode, setThemeMode] = useState(state.themeMode);
  const { activeNestedKind, openSubmenu, closeSubmenu } = useFloatingSubmenu();

  useEffect(() => {
    setAutoLaunch(state.autoLaunch);
    setLockScreenAfterIdle(state.lockScreenAfterIdle);
    setSelectedDisplayIds(state.selectedDisplayIds);
    setThemeMode(state.themeMode);
  }, [state.autoLaunch, state.lockScreenAfterIdle, state.selectedDisplayIds, state.themeMode]);

  async function toggleAutoLaunch(enabled: boolean) {
    const nextAutoLaunch = await window.xiabanla.setAutoLaunch(enabled);
    setAutoLaunch(nextAutoLaunch);
    onAutoLaunchChange(nextAutoLaunch);
  }

  async function toggleLockScreen(enabled: boolean) {
    const settings = await window.xiabanla.setLockScreenAfterIdle(enabled);
    setLockScreenAfterIdle(settings.lockScreenAfterIdle);
    onLockScreenAfterIdleChange(settings.lockScreenAfterIdle);
  }

  function updateTheme(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    saveThemeMode(nextThemeMode);
    onThemeModeChange(nextThemeMode);
  }

  function getThemeModeLabel(mode: ThemeMode) {
    if (mode === 'light') {
      return '浅色';
    }
    if (mode === 'dark') {
      return '深色';
    }
    return '跟随系统';
  }

  function openSettingsSubmenu(
    kind: MenuFloatingSurfaceKind,
    event: React.SyntheticEvent<HTMLElement>,
    options: Omit<MenuFloatingSurfaceRequest, 'kind' | 'anchorRect'> = {}
  ) {
    if (kind === 'settings-about') {
      openSubmenu(kind, event, {
        ...options,
        preferredWidth: getSettingsAboutMenuWidth(state.aboutInfo)
      });
      return;
    }

    openSubmenu(kind, event, options);
  }

  function openDisplaySubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-display', event, { placement: 'left-top' });
  }

  function openLockScreenSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-lock-screen', event, { placement: 'left-top' });
  }

  function openThemeSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-theme', event, { placement: 'left-top', preferredWidth: SETTINGS_THEME_MENU_WIDTH });
  }

  function openAboutSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-about', event, { placement: 'left-top' });
  }

  return (
    <section
      className={['floating-menu-surface', 'is-open', className].filter(Boolean).join(' ')}
      onMouseMove={(event) => {
        syncHoveredFloatingMenuRow(event);
        closeFloatingSubmenusFromParentPointer(event, closeSubmenu);
      }}
      onMouseLeave={clearHoveredFloatingMenuRow}
    >
      <label className="floating-menu-row settings-menu-row settings-switch-row">
        <span>开机自启</span>
        <input type="checkbox" checked={autoLaunch} onChange={(event) => void toggleAutoLaunch(event.target.checked)} />
      </label>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-display' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openDisplaySubmenu}
        onMouseMove={openDisplaySubmenu}
        onFocus={openDisplaySubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openDisplaySubmenu}>
          <span>提醒显示屏幕</span>
          <small>{formatSelectedDisplays(selectedDisplayIds, state.displays)}</small>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-lock-screen' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openLockScreenSubmenu}
        onMouseMove={openLockScreenSubmenu}
        onFocus={openLockScreenSubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openLockScreenSubmenu}>
          <span>自动熄屏</span>
          <small>{lockScreenAfterIdle ? '开' : '关'}</small>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-theme' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openThemeSubmenu}
        onMouseMove={openThemeSubmenu}
        onFocus={openThemeSubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openThemeSubmenu}>
          <span>外观</span>
          <small>{getThemeModeLabel(themeMode)}</small>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-about' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openAboutSubmenu}
        onMouseMove={openAboutSubmenu}
        onFocus={openAboutSubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openAboutSubmenu}>
          <span>关于软件</span>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <button className="floating-menu-row settings-menu-row" type="button" onClick={() => window.xiabanla.quitApp()}>
        <span>退出</span>
      </button>
    </section>
  );
}

function FloatingSurfaceApp(props: { route: FloatingRoute }) {
  const { route } = props;
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const themeClassName = themeMode === 'system' ? '' : `theme-${themeMode}`;
  const className = ['floating-surface-shell', themeClassName].filter(Boolean).join(' ');

  useEffect(() => {
    function closeByEscape(event: KeyboardEvent) {
      if (event.repeat || event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      void window.xiabanla.closeMenuFloatingSurface();
    }

    window.addEventListener('keydown', closeByEscape);
    return () => window.removeEventListener('keydown', closeByEscape);
  }, []);

  useEffect(() => {
    return subscribeThemeMode(setThemeMode);
  }, []);

  return (
    <main className={className}>
      {route.kind === 'settings' && <FloatingSettingsMenu />}
      {route.kind === 'settings-display' && <FloatingSettingsDisplayMenu />}
      {route.kind === 'settings-lock-screen' && <FloatingSettingsLockScreenMenu />}
      {route.kind === 'settings-theme' && <FloatingSettingsThemeMenu />}
      {route.kind === 'settings-about' && <FloatingSettingsAboutMenu />}
      {route.kind === 'external-sync' && <FloatingExternalSyncMenu />}
      {route.kind === 'reminder-context' && route.reminderId && <FloatingReminderContextMenu reminderId={route.reminderId} />}
      {route.kind === 'title-warning' && route.reminderId && (
        <FloatingTitleWarningMenu reminderId={route.reminderId} restoreTitle={route.restoreTitle} />
      )}
      {route.kind === 'reminder-date' && route.reminderId && <FloatingReminderDateMenu reminderId={route.reminderId} />}
      {route.kind === 'reminder-repeat' && route.reminderId && <FloatingReminderRepeatMenu reminderId={route.reminderId} />}
      {route.kind === 'today-override' && route.reminderId && <FloatingTodayOverrideMenu reminderId={route.reminderId} />}
      {route.kind === 'default-messages' && route.reminderId && <FloatingDefaultMessagesMenu />}
    </main>
  );
}

function FloatingSettingsMenu() {
  const [state, setState] = useState<SettingsMenuState | null>(null);

  useEffect(() => {
    void loadState();
    const unsubscribeAppSettings = window.xiabanla.onAppSettingsUpdated((settings) => {
      setState((current) => (current ? {
        ...current,
        lockScreenAfterIdle: settings.lockScreenAfterIdle,
        selectedDisplayIds: settings.selectedDisplayIds
      } : current));
    });
    const unsubscribeThemeMode = subscribeThemeMode((themeMode) => {
      setState((current) => (current ? { ...current, themeMode } : current));
    });
    return () => {
      unsubscribeAppSettings();
      unsubscribeThemeMode();
    };

    async function loadState() {
      const [displays, autoLaunch, appSettings, aboutInfo] = await Promise.all([
        window.xiabanla.getDisplays(),
        window.xiabanla.getAutoLaunch(),
        window.xiabanla.getAppSettings(),
        window.xiabanla.getAppAboutInfo()
      ]);
      setState({
        autoLaunch,
        lockScreenAfterIdle: appSettings.lockScreenAfterIdle,
        selectedDisplayIds: appSettings.selectedDisplayIds,
        themeMode: loadThemeMode(),
        displays,
        aboutInfo
      });
    }
  }, []);

  if (!state) {
    return <section className="settings-popover floating-surface-fill"><div className="empty-state">正在加载</div></section>;
  }

  return (
    <SettingsPopover
      className="settings-popover floating-surface-fill"
      state={state}
      onAutoLaunchChange={(autoLaunch) => setState((current) => (current ? { ...current, autoLaunch } : current))}
      onLockScreenAfterIdleChange={(lockScreenAfterIdle) => setState((current) => (current ? { ...current, lockScreenAfterIdle } : current))}
      onThemeModeChange={(themeMode) => setState((current) => (current ? { ...current, themeMode } : current))}
    />
  );
}

function FloatingSettingsDisplayMenu() {
  const [selectedDisplayIds, setSelectedDisplayIds] = useState<string[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.xiabanla.onAppSettingsUpdated((settings) => setSelectedDisplayIds(settings.selectedDisplayIds));
    return unsubscribe;

    async function refresh() {
      const [appSettings, nextDisplays] = await Promise.all([
        window.xiabanla.getAppSettings(),
        window.xiabanla.getDisplays()
      ]);
      setSelectedDisplayIds(appSettings.selectedDisplayIds);
      setDisplays(nextDisplays);
    }
  }, []);

  async function updateDisplay(displayId: string, checked: boolean) {
    const nextSelectedDisplayIds = updateSelectedDisplayIds(selectedDisplayIds, displays, displayId, checked);
    setSelectedDisplayIds(nextSelectedDisplayIds);
    const settings = await window.xiabanla.setSelectedDisplayIds(nextSelectedDisplayIds);
    setSelectedDisplayIds(settings.selectedDisplayIds);
  }

  return (
    <FloatingMenuSurface className="settings-display-submenu">
      {displays.map((display) => (
        <label className="settings-display-row" key={display.id}>
          <input
            type="checkbox"
            checked={selectedDisplayIds.includes(display.id)}
            disabled={selectedDisplayIds.length <= 1 && selectedDisplayIds.includes(display.id)}
            onChange={(event) => void updateDisplay(display.id, event.target.checked)}
          />
          <span title={display.label}>{display.label}</span>
        </label>
      ))}
    </FloatingMenuSurface>
  );
}

function FloatingSettingsLockScreenMenu() {
  const [lockScreenAfterIdle, setLockScreenAfterIdle] = useState<boolean | null>(null);

  useEffect(() => {
    void window.xiabanla.getAppSettings().then((settings) => setLockScreenAfterIdle(settings.lockScreenAfterIdle));
  }, []);

  async function toggleLockScreen(enabled: boolean) {
    const settings = await window.xiabanla.setLockScreenAfterIdle(enabled);
    setLockScreenAfterIdle(settings.lockScreenAfterIdle);
  }

  return (
    <FloatingMenuSurface className="settings-lock-submenu">
      <div className="settings-lock-options">
        <button className={lockScreenAfterIdle === true ? 'selected' : ''} type="button" onClick={() => void toggleLockScreen(true)}>开启</button>
        <button className={lockScreenAfterIdle === false ? 'selected' : ''} type="button" onClick={() => void toggleLockScreen(false)}>关闭</button>
      </div>
      <p className="settings-lock-description">
        <ShieldIcon />
        <span>全屏提醒10秒内未点击，将自动熄屏保护隐私。</span>
      </p>
    </FloatingMenuSurface>
  );
}

function FloatingSettingsThemeMenu() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());

  useEffect(() => subscribeThemeMode(setThemeMode), []);

  function updateTheme(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    saveThemeMode(nextThemeMode);
  }

  return (
    <FloatingMenuSurface className="settings-theme-submenu">
      {[
        { label: '跟随系统', value: 'system' as const },
        { label: '浅色', value: 'light' as const },
        { label: '深色', value: 'dark' as const }
      ].map((option) => (
        <button className={themeMode === option.value ? 'selected' : ''} type="button" key={option.value} onClick={() => updateTheme(option.value)}>
          {option.label}
        </button>
      ))}
    </FloatingMenuSurface>
  );
}

function FloatingSettingsAboutMenu() {
  const [aboutInfo, setAboutInfo] = useState<AppAboutInfo>(DEFAULT_APP_ABOUT_INFO);

  useEffect(() => {
    void window.xiabanla.getAppAboutInfo().then(setAboutInfo);
  }, []);

  return (
    <FloatingMenuSurface className="settings-about-submenu">
      <div className="settings-about-row">作者：李俊彦</div>
      <div className="settings-about-row">
        <span>小红书：</span>
        <button className="settings-about-link" type="button" onClick={() => void window.xiabanla.openExternalLink('https://www.xiaohongshu.com/user/profile/5bed9e4201e65d00013a32bf')}>@李俊彦的导演笔记（小红书号：chasingup）</button>
      </div>
      <div className="settings-about-row">
        <span>邮箱：</span>
        <button className="settings-about-link" type="button" onClick={() => void window.xiabanla.openExternalLink('mailto:chase_li@qq.com')}>chase_li@qq.com</button>
      </div>
      <div className="settings-about-row">Version {aboutInfo.version}</div>
      <div className="settings-about-row">Copyright © {aboutInfo.currentYear} 佛山市戴胜文化传媒有限公司</div>
    </FloatingMenuSurface>
  );
}

function FloatingExternalSyncMenu() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [externalAccess, setExternalAccess] = useState<ExternalSourceAccess[]>([]);
  const [externalEventsLoading, setExternalEventsLoading] = useState(true);
  const [externalPanelTab, setExternalPanelTab] = useState<ExternalPanelTab>('calendar');
  const calendarExternalEvents = externalEvents.filter((event) => event.provider === 'macos-calendar' || event.provider === 'windows-calendar');
  const reminderExternalEvents = externalEvents.filter((event) => event.provider === 'macos-reminders' && !isExternalEventHistorical(event));
  const activeExternalEvents = externalPanelTab === 'calendar' ? calendarExternalEvents : reminderExternalEvents;
  const activeExternalEmptyText = getExternalEmptyText(externalPanelTab, externalAccess);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.xiabanla.onRemindersUpdated(setReminders);
    return unsubscribe;

    async function refresh() {
      setExternalEventsLoading(true);
      try {
        const [nextReminders, nextDisplays, result] = await Promise.all([
          window.xiabanla.getReminders(),
          window.xiabanla.getDisplays(),
          window.xiabanla.listExternalEvents()
        ]);
        setReminders(nextReminders);
        setDisplays(nextDisplays);
        setExternalEvents(result.events);
        setExternalAccess(result.access);
      } finally {
        setExternalEventsLoading(false);
      }
    }
  }, []);

  async function addExternalReminder(event: ExternalEvent) {
    if (isExternalEventLinked(event, reminders)) {
      return;
    }
    const primaryDisplay = displays.find((display) => display.isPrimary) || displays[0];
    await window.xiabanla.saveReminder(createReminder(primaryDisplay?.id, {
      ...createExternalReminderPatch(event)
    }));
  }

  return (
    <FloatingMenuSurface className="external-popover" id="external-sync-panel">
      <div className="panel-heading">
        <h2>本机日程&提醒</h2>
        <div className="external-tabs" role="tablist" aria-label="本机同步类型">
          <button type="button" className={externalPanelTab === 'calendar' ? 'selected' : ''} onClick={() => setExternalPanelTab('calendar')} role="tab" aria-selected={externalPanelTab === 'calendar'}>日历日程</button>
          <button type="button" className={externalPanelTab === 'reminders' ? 'selected' : ''} onClick={() => setExternalPanelTab('reminders')} role="tab" aria-selected={externalPanelTab === 'reminders'}>提醒事项</button>
        </div>
      </div>
      <div className="compact-list external-popover-list">
        {externalEventsLoading && <div className="empty-state">{getExternalLoadingText(externalPanelTab)}</div>}
        {!externalEventsLoading && activeExternalEvents.length === 0 && <div className="empty-state">{activeExternalEmptyText}</div>}
        {activeExternalEvents.map((event) => {
          const linked = isExternalEventLinked(event, reminders);
          const title = formatExternalEventTitle(event);
          const meta = formatExternalEventMeta(event, linked);
          return (
            <button type="button" className={linked ? 'external-row external-row-linked' : 'external-row'} key={`${event.provider}:${event.id}`} onClick={() => void addExternalReminder(event)} disabled={linked}>
              <span>{title}</span>
              <small>{meta}</small>
            </button>
          );
        })}
      </div>
    </FloatingMenuSurface>
  );
}

async function getEditableReminderState(reminderId: string): Promise<EditableReminderState | null> {
  const reminders = await window.xiabanla.getReminders();
  const workdayReminder = findOffWorkReminder(reminders);
  const reminder = reminders.find((item) => item.id === reminderId);
  if (reminder) {
    return { reminder, isDraft: false, workdayReminder };
  }

  const draftReminder = await window.xiabanla.getDraftReminder(reminderId);
  return draftReminder ? { reminder: draftReminder, isDraft: true, workdayReminder } : null;
}

function FloatingReminderContextMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [editableReminder, setEditableReminder] = useState<EditableReminderState | null>(null);

  useEffect(() => {
    void refresh();
    const unsubscribeReminders = window.xiabanla.onRemindersUpdated(() => {
      void refresh();
    });
    const unsubscribeDraft = window.xiabanla.onDraftReminderUpdated((id) => {
      if (id === reminderId) {
        void refresh();
      }
    });
    return () => {
      unsubscribeReminders();
      unsubscribeDraft();
    };

    async function refresh() {
      setEditableReminder(await getEditableReminderState(reminderId));
    }
  }, [reminderId]);

  if (!editableReminder) {
    return <FloatingMenuSurface className="context-menu"><div className="context-readonly-hint">提醒不存在</div></FloatingMenuSurface>;
  }

  return (
    <ReminderContextMenu
      className="context-menu floating-surface-fill"
      reminder={editableReminder.reminder}
      onSaveReminder={editableReminder.isDraft ? (reminder) => window.xiabanla.saveDraftReminder(reminder) : undefined}
      onRequestDelete={editableReminder.isDraft ? (reminder) => window.xiabanla.deleteDraftReminder(reminder.id) : undefined}
      onClose={() => void window.xiabanla.closeMenuFloatingSurface()}
    />
  );
}

function FloatingTitleWarningMenu(props: { reminderId: string; restoreTitle?: string }) {
  const { reminderId, restoreTitle } = props;
  const [reminderState, setReminderState] = useState<'draft' | 'saved' | 'missing'>('draft');

  useEffect(() => {
    void refresh();
    const unsubscribeDraft = window.xiabanla.onDraftReminderUpdated((id, reminder) => {
      if (id === reminderId) {
        if (reminder) {
          setReminderState('draft');
          return;
        }
        void refresh();
      }
    });
    const unsubscribeReminders = window.xiabanla.onRemindersUpdated(() => {
      void refresh();
    });
    return () => {
      unsubscribeDraft();
      unsubscribeReminders();
    };

    async function refresh() {
      if (await window.xiabanla.getDraftReminder(reminderId)) {
        setReminderState('draft');
        return;
      }
      const reminders = await window.xiabanla.getReminders();
      setReminderState(reminders.some((reminder) => reminder.id === reminderId) ? 'saved' : 'missing');
    }
  }, [reminderId]);

  async function returnToEdit() {
    await window.xiabanla.closeMenuFloatingSurface('title-warning');
  }

  async function undoEdit() {
    if (reminderState === 'draft') {
      await window.xiabanla.deleteDraftReminder(reminderId);
      await window.xiabanla.closeMenuFloatingSurface('title-warning');
      return;
    }

    const reminders = await window.xiabanla.getReminders();
    const reminder = reminders.find((item) => item.id === reminderId);
    if (reminder && restoreTitle !== undefined) {
      await window.xiabanla.saveReminder({ ...reminder, name: restoreTitle });
    }
    await window.xiabanla.closeMenuFloatingSurface('title-warning');
  }

  const exists = reminderState !== 'missing';
  return (
    <FloatingMenuSurface className="title-warning-menu" role="dialog" id="title-warning-menu">
      <strong>{exists ? '未输入标题' : '提醒不存在'}</strong>
      <div className="title-warning-actions">
        <button type="button" onClick={() => void returnToEdit()} disabled={!exists}>返回编辑</button>
        <button className="context-danger" type="button" onClick={() => void undoEdit()} disabled={!exists}>
          {reminderState === 'draft' ? '取消添加' : '撤销编辑'}
        </button>
      </div>
    </FloatingMenuSurface>
  );
}

function FloatingReminderDateMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [editableReminder, setEditableReminder] = useState<EditableReminderState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [calendarMonth, setCalendarMonth] = useState(() => getCalendarMonth());

  useEffect(() => {
    void refresh();
    const unsubscribeReminders = window.xiabanla.onRemindersUpdated(() => {
      void refresh();
    });
    const unsubscribeDraft = window.xiabanla.onDraftReminderUpdated((id) => {
      if (id === reminderId) {
        void refresh();
      }
    });
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      unsubscribeReminders();
      unsubscribeDraft();
      window.clearInterval(timer);
    };

    async function refresh() {
      setEditableReminder(await getEditableReminderState(reminderId));
    }
  }, [reminderId]);

  async function saveDate(dateKey: string) {
    if (!editableReminder) {
      return;
    }
    const nextReminder = { ...editableReminder.reminder, ...createDueDatePatch(editableReminder.reminder, dateKey) };
    if (editableReminder.isDraft) {
      await window.xiabanla.saveDraftReminder(nextReminder);
    } else {
      await window.xiabanla.saveReminder(nextReminder);
    }
    await window.xiabanla.closeMenuFloatingSurface();
  }

  if (!editableReminder) {
    return <FloatingMenuSurface className="context-submenu context-date-submenu"><div className="context-readonly-hint">提醒不存在</div></FloatingMenuSurface>;
  }

  const reminder = editableReminder.reminder;
  const reminderDueDateKey = getReminderDueDateKey(reminder, now);
  const todayDateKey = toDateKey(now);
  return (
    <FloatingMenuSurface className="context-submenu context-date-submenu" role="menu">
      <div className="context-date-shortcuts" role="group" aria-label="快捷日期">
        <button role="menuitem" type="button" onClick={() => void saveDate(toDateKey(now))}>今天</button>
        <button role="menuitem" type="button" onClick={() => void saveDate(addDays(now, 1))}>明天</button>
        <button role="menuitem" type="button" onClick={() => void saveDate(addDays(now, 7))}>下周</button>
      </div>
      <section className="context-calendar" aria-label="日历视图">
        <div className="context-calendar-header">
          <button type="button" aria-label="上个月" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>‹</button>
          <strong>{formatCalendarMonth(calendarMonth)}</strong>
          <button type="button" aria-label="下个月" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>›</button>
        </div>
        <div className="context-calendar-weekdays" aria-hidden="true">
          {WEEK_DAYS.map((day) => <span key={day.value}>{day.label}</span>)}
        </div>
        <div className="context-calendar-grid">
          {getCalendarDays(calendarMonth).map((day) => (
            <button
              type="button"
              key={day.dateKey}
              className={[
                'context-calendar-day',
                day.inCurrentMonth ? '' : 'outside-month',
                day.dateKey === todayDateKey ? 'today' : '',
                day.dateKey === reminderDueDateKey ? 'selected' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => void saveDate(day.dateKey)}
            >
              <span className="context-calendar-day-number">{day.dayOfMonth}</span>
            </button>
          ))}
        </div>
      </section>
    </FloatingMenuSurface>
  );
}

function FloatingReminderRepeatMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [editableReminder, setEditableReminder] = useState<EditableReminderState | null>(null);

  useEffect(() => {
    void refresh();
    const unsubscribeReminders = window.xiabanla.onRemindersUpdated(() => {
      void refresh();
    });
    const unsubscribeDraft = window.xiabanla.onDraftReminderUpdated((id) => {
      if (id === reminderId) {
        void refresh();
      }
    });
    return () => {
      unsubscribeReminders();
      unsubscribeDraft();
    };

    async function refresh() {
      setEditableReminder(await getEditableReminderState(reminderId));
    }
  }, [reminderId]);

  async function savePatch(patch: Partial<Reminder>) {
    if (!editableReminder) {
      return;
    }
    const nextReminder = { ...editableReminder.reminder, ...patch };
    const saved = editableReminder.isDraft
      ? await window.xiabanla.saveDraftReminder(nextReminder)
      : await window.xiabanla.saveReminder(nextReminder);
    setEditableReminder({ ...editableReminder, reminder: saved });
  }

  return (
    <FloatingMenuSurface className="context-submenu context-repeat-submenu" role="menu">
      {editableReminder ? (
        <ReminderRepeatPicker
          reminder={editableReminder.reminder}
          workdayReminder={editableReminder.workdayReminder}
          allowNoRepeat
          onChange={(patch) => void savePatch(patch)}
        />
      ) : <div className="context-readonly-hint">提醒不存在</div>}
    </FloatingMenuSurface>
  );
}

function FloatingTodayOverrideMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [reminder, setReminder] = useState<Reminder | null>(null);

  useEffect(() => {
    void window.xiabanla.getReminders().then((reminders) => setReminder(reminders.find((item) => item.id === reminderId) || null));
    const unsubscribe = window.xiabanla.onRemindersUpdated((reminders) => {
      setReminder(reminders.find((item) => item.id === reminderId) || null);
    });
    return unsubscribe;
  }, [reminderId]);

  async function updateTodayOverride(time: string) {
    if (!reminder) {
      return;
    }
    const saved = await window.xiabanla.saveReminder({
      ...reminder,
      todayOverrideTime: time || undefined,
      todayOverrideDate: time ? toDateKey(new Date()) : undefined
    });
    setReminder(saved);
  }

  function updateTodayOverrideByOffset(offsetMinutes: number) {
    if (reminder) {
      void updateTodayOverride(shiftTimeByMinutes(reminder.dailyTime, offsetMinutes));
    }
  }

  return (
    <FloatingMenuSurface className="tertiary-submenu">
      {reminder ? (
        <>
          <label>
            输入今天下班时间
            <TimeField
              value={reminder.todayOverrideTime || ''}
              placeholder={reminder.todayOverrideTime || reminder.dailyTime}
              allowEmpty
              commitOnValidChange
              onChange={updateTodayOverride}
            />
          </label>
          <div className="today-override-quick-actions">
            <button type="button" onClick={() => updateTodayOverrideByOffset(-120)}>早走 2 小时</button>
            <button type="button" onClick={() => updateTodayOverrideByOffset(120)}>晚走 2 小时</button>
          </div>
          {reminder.todayOverrideTime && <button type="button" onClick={() => void updateTodayOverride('')}>恢复默认</button>}
        </>
      ) : <div className="empty-state">提醒不存在</div>}
    </FloatingMenuSurface>
  );
}

function FloatingDefaultMessagesMenu() {
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

function SettingsApp(props: { foregroundReminderActive?: boolean }) {
  const { foregroundReminderActive: foregroundReminderActiveProp = false } = props;
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalEvent[]>([]);
  const [externalAccess, setExternalAccess] = useState<ExternalSourceAccess[]>([]);
  const [externalEventsLoading, setExternalEventsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string>('');
  const [expandedMode, setExpandedMode] = useState<ReminderExpansionMode>('quick');
  const [activeFloatingSurface, setActiveFloatingSurface] = useState<MenuFloatingSurfaceKind | null>(null);
  const [externalPanelTab, setExternalPanelTab] = useState<ExternalPanelTab>('calendar');
  const [contextMenuState, setContextMenuState] = useState<ReminderContextMenuState | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [lockScreenAfterIdle, setLockScreenAfterIdle] = useState(false);
  const [appAboutInfo, setAppAboutInfo] = useState<AppAboutInfo>(DEFAULT_APP_ABOUT_INFO);
  const [defaultMessageDrafts, setDefaultMessageDrafts] = useState<ReminderMessage[]>([]);
  const [defaultMessagesSaving, setDefaultMessagesSaving] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState('正在加载配置...');
  const [menuPanelExiting, setMenuPanelExiting] = useState(false);
  const [nativeReminderOverlayVisible, setNativeReminderOverlayVisible] = useState(false);
  const [offWorkDraft, setOffWorkDraft] = useState<Reminder | null>(null);
  const [newReminderDraft, setNewReminderDraft] = useState<Reminder | null>(null);
  const [deleteUndoBatch, setDeleteUndoBatch] = useState<DeleteUndoBatch>(null);
  const [hoveredReminderId, setHoveredReminderId] = useState('');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const remindersRef = useRef<Reminder[]>([]);
  const expandedIdRef = useRef('');
  const titleEditOriginalNamesRef = useRef(new Map<string, string>());
  const newReminderDraftRef = useRef<Reminder | null>(null);
  const newReminderDraftInitialRef = useRef<Reminder | null>(null);
  const newReminderDraftEditedRef = useRef(false);
  const latestSaveVersionRef = useRef(new Map<string, number>());
  const deletedReminderIdsRef = useRef(new Set<string>());
  const suppressNextBlankCreateRef = useRef(false);
  const suppressBlankCreateUntilRef = useRef(0);
  const suppressTitleWarningExitUntilRef = useRef(0);
  const restoreTitleWarningOnShowRef = useRef(false);
  const titleWarningReminderIdRef = useRef('');
  const activeFloatingSurfaceRef = useRef<MenuFloatingSurfaceKind | null>(null);
  const contextMenuStateRef = useRef<ReminderContextMenuState | null>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const deleteUndoVersionRef = useRef(0);
  const defaultMessagesAutoSaveTimerRef = useRef<number | null>(null);
  const defaultMessagesSaveVersionRef = useRef(0);
  const offWorkReminder = useMemo(() => findOffWorkReminder(reminders), [reminders]);
  const displayedOffWorkReminder = offWorkDraft || offWorkReminder || null;
  const offWorkExpanded = Boolean(offWorkDraft || (offWorkReminder && expandedId === offWorkReminder.id));
  const currentDateKey = toDateKey(now);

  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);
  useEffect(() => {
    expandedIdRef.current = expandedId;
  }, [expandedId]);
  useEffect(() => {
    newReminderDraftRef.current = newReminderDraft;
  }, [newReminderDraft]);
  useEffect(() => {
    activeFloatingSurfaceRef.current = activeFloatingSurface;
  }, [activeFloatingSurface]);
  useEffect(() => {
    contextMenuStateRef.current = contextMenuState;
  }, [contextMenuState]);
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
  const calendarExternalEvents = useMemo(
    () => externalEvents.filter((event) => event.provider === 'macos-calendar' || event.provider === 'windows-calendar'),
    [externalEvents]
  );
  const reminderExternalEvents = useMemo(
    () => externalEvents.filter((event) => event.provider === 'macos-reminders' && !isExternalEventHistorical(event)),
    [externalEvents]
  );
  const activeExternalEvents = externalPanelTab === 'calendar' ? calendarExternalEvents : reminderExternalEvents;
  const activeExternalEmptyText = getExternalEmptyText(externalPanelTab, externalAccess);
  const registerMoreReminderElement = useListReorderMotion(animatedMoreReminders, (item) => item.key);
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
    void refresh();
    void syncLinkedExternalReminders();
    void window.xiabanla.getAutoLaunch().then(setAutoLaunch);
    void window.xiabanla.getAppSettings().then((settings) => setLockScreenAfterIdle(settings.lockScreenAfterIdle));
    void window.xiabanla.getAppAboutInfo().then(setAppAboutInfo);
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    const externalSyncTimer = window.setInterval(() => {
      void syncLinkedExternalReminders({ silent: true });
    }, 60_000);
    const unsubscribe = window.xiabanla.onRemindersUpdated((nextReminders) => {
      setReminders(nextReminders);
    });
    const unsubscribeDefaultMessages = window.xiabanla.onDefaultMessagesUpdated((messages) => {
      setDefaultMessageDrafts(messages);
    });
    const unsubscribeAppSettings = window.xiabanla.onAppSettingsUpdated((settings) => {
      setLockScreenAfterIdle(settings.lockScreenAfterIdle);
    });
    const unsubscribeReminderOverlayVisibility = window.xiabanla.onReminderOverlayVisibilityChanged((visible) => {
      setNativeReminderOverlayVisible(visible);
    });
    const unsubscribeReminderDeleteRequested = window.xiabanla.onReminderDeleteRequested((id) => {
      const reminder = remindersRef.current.find((item) => item.id === id);
      if (!reminder) {
        setNotice('提醒不存在');
        return;
      }
      void deleteReminder(reminder);
    });
    const unsubscribeDraftReminder = window.xiabanla.onDraftReminderUpdated((id, reminder) => {
      if (newReminderDraftRef.current?.id !== id) {
        return;
      }
      if (reminder && isNewReminderDraftEdited(reminder, newReminderDraftInitialRef.current)) {
        newReminderDraftEditedRef.current = true;
      }
      newReminderDraftRef.current = reminder;
      setNewReminderDraft(reminder);
      if (!reminder) {
        newReminderDraftEditedRef.current = false;
        newReminderDraftInitialRef.current = null;
        setExpandedId((current) => (current === id ? '' : current));
        setExpandedMode('quick');
        setNotice('已取消新增提醒');
      }
    });
    return () => {
      window.clearInterval(timer);
      window.clearInterval(externalSyncTimer);
      clearDeleteUndoTimer();
      clearDefaultMessagesAutoSaveTimer();
      unsubscribe();
      unsubscribeDefaultMessages();
      unsubscribeAppSettings();
      unsubscribeReminderOverlayVisibility();
      unsubscribeReminderDeleteRequested();
      unsubscribeDraftReminder();
    };
  }, []);

  useEffect(() => {
    return subscribeThemeMode(setThemeMode);
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
      restoreTitleWarningOnShowRef.current = activeFloatingSurfaceRef.current === 'title-warning';
      setMenuPanelExiting(true);
      // 退回后台后再次打开面板应回到轻量收起态，避免保留上一次展开编辑现场。
      collapseOffWorkExpandedCard();
      clearFloatingSurfaceState();
      void window.xiabanla.closeMenuFloatingSurface();
      resetTimer = window.setTimeout(() => {
        setMenuPanelExiting(false);
        resetTimer = null;
      }, MENU_PANEL_ANIMATION_MS + 80);
    });
    const unsubscribeDidShow = window.xiabanla.onMenuPanelDidShow(() => {
      clearResetTimer();
      setMenuPanelExiting(false);
      if (restoreTitleWarningOnShowRef.current) {
        restoreTitleWarningOnShowRef.current = false;
        restoreWarningFrame = window.requestAnimationFrame(() => {
          restoreWarningFrame = null;
          const reminder = getReminderForTitleEdit(titleWarningReminderIdRef.current);
          if (reminder && shouldBlockMissingTitleEditExit(reminder)) {
            void openTitleWarningMenu(reminder);
          }
        });
      }
    });
    const unsubscribeOpenSettings = window.xiabanla.onMenuPanelOpenSettings(() => {
      clearResetTimer();
      clearRestoreWarningFrame();
      restoreTitleWarningOnShowRef.current = false;
      setMenuPanelExiting(false);
      clearFloatingSurfaceState();
      setOffWorkDraft(null);
      setExpandedId('');
      setExpandedMode('quick');
      void openSettingsMenu();
    });
    const unsubscribeFloatingClosed = window.xiabanla.onMenuFloatingSurfaceClosed((kind) => {
      handleFloatingSurfaceClosed(kind);
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
      if (activeFloatingSurfaceRef.current === 'title-warning') {
        suppressTitleWarningOutsideClose();
        void closeFloatingSurface('title-warning');
        return;
      }
      const missingTitleReminder = getMissingTitleReminderForInteraction();
      if (missingTitleReminder) {
        void openTitleWarningMenu(missingTitleReminder);
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
      setHoveredReminderId((current) => {
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
    if (offWorkExpanded) {
      void window.xiabanla.closeMenuFloatingSurface('external-sync');
      setActiveFloatingSurface((current) => (current === 'external-sync' ? null : current));
    }
  }, [offWorkExpanded]);

  useEffect(() => {
    if (!offWorkExpanded || foregroundReminderActive) {
      return undefined;
    }

    function collapseOffWorkByEscape(event: KeyboardEvent) {
      if (event.repeat || event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      collapseOffWorkExpandedCard();
    }

    window.addEventListener('keydown', collapseOffWorkByEscape);
    return () => {
      window.removeEventListener('keydown', collapseOffWorkByEscape);
    };
  }, [foregroundReminderActive, offWorkExpanded]);

  useEffect(() => {
    if (!offWorkDraft || foregroundReminderActive) {
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
        suppressNextBlankCreateRef.current = true;
      }

      cancelOffWorkDraft();
    }

    window.addEventListener('mousedown', cancelOffWorkDraftByOutsideClick);
    return () => {
      window.removeEventListener('mousedown', cancelOffWorkDraftByOutsideClick);
    };
  }, [foregroundReminderActive, offWorkDraft, offWorkReminder]);

  useEffect(() => {
    if (!expandedId) {
      return undefined;
    }

    function closeQuickEditByOutsideClick(event: MouseEvent) {
      const target = getEventElement(event.target);
      if (!target) {
        return;
      }
      const targetReminderItem = target.closest('.reminder-menu-item');
      if (targetReminderItem?.getAttribute('data-reminder-id') === expandedId) {
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
        suppressNextBlankCreateRef.current = true;
      }
      const blockingReminder = getMissingTitleReminderForInteraction();
      if (blockingReminder) {
        event.preventDefault();
        event.stopPropagation();
        void openTitleWarningMenu(blockingReminder);
        return;
      }
      if (!finishQuickEdit(expandedId)) {
        return;
      }
    }

    window.addEventListener('mousedown', closeQuickEditByOutsideClick);
    return () => {
      window.removeEventListener('mousedown', closeQuickEditByOutsideClick);
    };
  }, [expandedId, newReminderDraft]);

  async function refresh() {
    const [nextReminders, nextDisplays, nextAutoLaunch, nextDefaultMessages, nextAppSettings] = await Promise.all([
      window.xiabanla.getReminders(),
      window.xiabanla.getDisplays(),
      window.xiabanla.getAutoLaunch(),
      window.xiabanla.getDefaultMessages(),
      window.xiabanla.getAppSettings()
    ]);
    setReminders(nextReminders);
    setDisplays(nextDisplays);
    setAutoLaunch(nextAutoLaunch);
    setDefaultMessageDrafts(nextDefaultMessages);
    setLockScreenAfterIdle(nextAppSettings.lockScreenAfterIdle);
    setNotice('配置已加载');
  }

  function upsertReminder(reminder: Reminder) {
    setReminders((items) => {
      const exists = items.some((item) => item.id === reminder.id);
      return exists ? items.map((item) => (item.id === reminder.id ? reminder : item)) : [reminder, ...items];
    });
  }

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

  async function saveReminder(reminder: Reminder, message = '已自动保存') {
    deletedReminderIdsRef.current.delete(reminder.id);
    const saveVersion = (latestSaveVersionRef.current.get(reminder.id) || 0) + 1;
    latestSaveVersionRef.current.set(reminder.id, saveVersion);
    upsertReminder(reminder);
    setNotice('正在自动保存...');

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
          setNotice(message);
        }
        return saved;
      });

    saveQueueRef.current = saveTask.then(() => undefined);

    try {
      return await saveTask;
    } catch (error) {
      if (latestSaveVersionRef.current.get(reminder.id) === saveVersion) {
        setNotice(error instanceof Error ? error.message : '自动保存失败');
      }
      throw error;
    }
  }

  async function addOffWorkReminder() {
    if (blockOtherInteractionWhenReminderTitleMissing()) {
      return;
    }

    if (offWorkReminder?.enabled) {
      setNotice('下班提醒已存在');
      return;
    }

    const primaryDisplay = displays.find((display) => display.isPrimary) || displays[0];
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
      ...offWorkReminder,
      id: OFF_WORK_REMINDER_ID,
      name: offWorkReminder?.name || '下班提醒',
      enabled: true
    };
    setOffWorkDraft(draft);
    setExpandedId(OFF_WORK_REMINDER_ID);
    setExpandedMode('full');
    setNotice('请先配置下班提醒');
  }

  async function submitOffWorkDraft() {
    if (!offWorkDraft) {
      return;
    }

    const saved = await saveReminder(offWorkDraft, offWorkReminder ? '已恢复下班提醒' : '已添加下班提醒');
    setOffWorkDraft(null);
    setExpandedId(saved.id);
    setExpandedMode('full');
  }

  function addReminder() {
    if (newReminderDraft) {
      setExpandedId(newReminderDraft.id);
      setExpandedMode('quick');
      return;
    }

    const primaryDisplay = displays.find((display) => display.isPrimary) || displays[0];
    const reminder = createReminder(primaryDisplay?.id, {
      name: '',
      repeatRule: 'once',
      scheduledDate: toDateKey(new Date()),
      dailyTime: nextHourTime(new Date())
    });
    newReminderDraftInitialRef.current = reminder;
    newReminderDraftEditedRef.current = false;
    updateNewReminderDraft(reminder, false);
    setExpandedId(reminder.id);
    setExpandedMode('quick');
    setNotice('请输入标题');
  }

  function suppressBlankCreateAfterMenuInteraction() {
    suppressNextBlankCreateRef.current = true;
    suppressBlankCreateUntilRef.current = Date.now() + REMINDER_BLANK_CREATE_MENU_SUPPRESS_MS;
  }

  function suppressTitleWarningOutsideClose() {
    suppressBlankCreateAfterMenuInteraction();
    suppressTitleWarningExitUntilRef.current = Date.now() + REMINDER_BLANK_CREATE_MENU_SUPPRESS_MS;
  }

  function isTitleWarningOutsideCloseSuppressed() {
    return Date.now() < suppressTitleWarningExitUntilRef.current;
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

    return remindersRef.current.some((item) => item.id === reminder.id);
  }

  function getReminderForTitleEdit(reminderId: string) {
    if (!reminderId) {
      return null;
    }
    if (newReminderDraftRef.current?.id === reminderId) {
      return syncFocusedNewReminderDraftQuickField(reminderId) || newReminderDraftRef.current;
    }

    return remindersRef.current.find((reminder) => reminder.id === reminderId) || null;
  }

  function getMissingTitleReminderForInteraction() {
    const activeDraft = newReminderDraftRef.current;
    if (activeDraft) {
      const syncedDraft = syncFocusedNewReminderDraftQuickField(activeDraft.id) || activeDraft;
      if (shouldBlockMissingTitleEditExit(syncedDraft)) {
        return syncedDraft;
      }
    }

    const expandedReminder = getReminderForTitleEdit(expandedIdRef.current);
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
        expandedIdRef.current = '';
        setExpandedId('');
        setExpandedMode('quick');
        setNotice('已取消新增提醒');
        return true;
      }

      void saveReminder({ ...activeReminder, name }, successNotice);
    } else if (name !== activeReminder.name) {
      void saveReminder({ ...activeReminder, name });
    }

    clearReminderTitleEditSnapshot(activeReminder.id);
    expandedIdRef.current = '';
    setExpandedId('');
    setExpandedMode('quick');
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
    suppressBlankCreateAfterMenuInteraction();
    setExpandedId(reminder.id);
    setExpandedMode('quick');
    titleWarningReminderIdRef.current = reminder.id;
    const restoreTitle = getReminderTitleRestoreValue(reminder);
    if (newReminderDraftRef.current?.id === reminder.id) {
      newReminderDraftRef.current = reminder;
      await window.xiabanla.saveDraftReminder(reminder);
    }
    await waitForNextAnimationFrame();

    const anchorElement = getTitleWarningAnchorElement(reminder.id);
    if (!anchorElement) {
      setNotice('未输入标题');
      return;
    }

    await openFloatingSurface({
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
    expandedIdRef.current = '';
    setNewReminderDraft(null);
    void window.xiabanla.deleteDraftReminder(activeDraft.id);
    setExpandedId((current) => (current === activeDraft.id ? '' : current));
    setExpandedMode('quick');
    setNotice('已取消新增提醒');
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

    addReminder();
  }

  function updateHoveredReminder(event: React.MouseEvent<HTMLDivElement>) {
    const nextHoveredReminderId = getHoveredReminderIdFromTarget(event.target);
    setHoveredReminderId((current) => (current === nextHoveredReminderId ? current : nextHoveredReminderId));
  }

  function finishQuickEdit(reminderId: string) {
    const reminder = getReminderForTitleEdit(reminderId);
    if (reminder) {
      return finishReminderTitleEdit(reminder);
    }

    if (expandedIdRef.current === reminderId) {
      expandedIdRef.current = '';
    }
    setExpandedId((current) => (current === reminderId ? '' : current));
    setExpandedMode('quick');
    return true;
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

    rememberReminderTitleBeforeEdit(reminder);
    setExpandedMode('quick');
    setExpandedId(reminder.id);
  }

  function commitQuickEdit(reminder: Reminder) {
    const currentReminder = newReminderDraftRef.current?.id === reminder.id
      ? syncFocusedNewReminderDraftQuickField(reminder.id) || newReminderDraftRef.current || reminder
      : reminder;
    finishReminderTitleEdit(currentReminder);
  }

  async function deleteReminder(reminder: Reminder, successNotice = '已删除提醒') {
    if (newReminderDraft?.id === reminder.id) {
      newReminderDraftRef.current = null;
      newReminderDraftInitialRef.current = null;
      newReminderDraftEditedRef.current = false;
      clearReminderTitleEditSnapshot(reminder.id);
      setNewReminderDraft(null);
      await window.xiabanla.deleteDraftReminder(reminder.id);
      setExpandedId((current) => (current === reminder.id ? '' : current));
      setExpandedMode('quick');
      setNotice('已取消新增提醒');
      return;
    }
    deletedReminderIdsRef.current.add(reminder.id);
    latestSaveVersionRef.current.delete(reminder.id);
    setReminders((items) => items.filter((item) => item.id !== reminder.id));
    setExpandedId((current) => (current === reminder.id ? '' : current));
    setExpandedMode('quick');
    addReminderToUndoBatch(reminder);
    setNotice('正在自动保存...');
    const deleteTask = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await window.xiabanla.deleteReminder(reminder.id);
        setNotice(successNotice);
      });
    saveQueueRef.current = deleteTask.then(() => undefined);
    await deleteTask;
  }

  async function restoreDeletedReminders() {
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

  async function loadExternalEvents() {
    setExternalEventsLoading(true);
    setNotice(getExternalLoadingText(externalPanelTab));
    try {
      const result = await window.xiabanla.listExternalEvents();
      setExternalEvents(result.events);
      setExternalAccess(result.access);
      setNotice(result.message);
    } catch (error) {
      setExternalEvents([]);
      setExternalAccess([]);
      setNotice(error instanceof Error ? error.message : '读取系统日历和提醒事项失败');
    } finally {
      setExternalEventsLoading(false);
    }
  }

  async function toggleExternalPanel(element: Element) {
    if (blockOtherInteractionWhenReminderTitleMissing()) {
      return;
    }

    await toggleFloatingSurfaceFromElement('external-sync', element, {
      placement: 'bottom-left'
    });
  }

  async function syncLinkedExternalReminders(options: { silent?: boolean } = {}) {
    const currentReminders = reminders.length > 0 ? reminders : await window.xiabanla.getReminders();
    const hasLinkedExternalReminder = currentReminders.some((reminder) => reminder.linkedExternalSource);
    if (!hasLinkedExternalReminder) {
      return;
    }

    try {
      const result = await window.xiabanla.syncExternalSources();
      await refresh();
      if (!options.silent) {
        setNotice(result.message);
      }
    } catch (error) {
      if (!options.silent) {
        setNotice(error instanceof Error ? error.message : '本机同步失败');
      }
    }
  }

  async function addExternalReminder(event: ExternalEvent) {
    if (isExternalEventLinked(event, reminders)) {
      setNotice('这个本机项目已同步');
      return;
    }

    const primaryDisplay = displays.find((display) => display.isPrimary) || displays[0];
    const reminder = createReminder(primaryDisplay?.id, {
      ...createExternalReminderPatch(event)
    });
    await saveReminder(reminder, '已添加本机同步提醒');
    setExpandedId('');
    setExpandedMode('quick');
  }

  function updateThemeMode(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    saveThemeMode(nextThemeMode);
    setNotice(nextThemeMode === 'system' ? '已跟随系统外观' : `已切换为${nextThemeMode === 'dark' ? '深色' : '浅色'}模式`);
  }

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

  function collapseOffWorkExpandedCard() {
    setOffWorkDraft(null);
    setExpandedId('');
    setExpandedMode('quick');
  }

  function cancelOffWorkDraft() {
    collapseOffWorkExpandedCard();
    setNotice(offWorkReminder ? '已取消恢复下班提醒' : '已取消添加下班提醒');
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

  function clearFloatingSurfaceState(kind?: MenuFloatingSurfaceKind) {
    if (!kind || activeFloatingSurfaceRef.current === kind) {
      activeFloatingSurfaceRef.current = null;
      setActiveFloatingSurface(null);
    }

    if (!kind || kind === 'reminder-context') {
      contextMenuStateRef.current = null;
      setContextMenuState(null);
    }
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

  async function returnReminderTitleEdit(reminderId: string) {
    if (!reminderId) {
      return;
    }

    const draftReminder = await window.xiabanla.getDraftReminder(reminderId);
    const reminder = draftReminder || (await window.xiabanla.getReminders()).find((item) => item.id === reminderId) || null;
    if (!reminder || !shouldBlockMissingTitleEditExit(reminder)) {
      clearReminderTitleEditSnapshot(reminderId);
      if (expandedIdRef.current === reminderId) {
        expandedIdRef.current = '';
        setExpandedId('');
        setExpandedMode('quick');
      }
      return;
    }

    setExpandedId(reminderId);
    setExpandedMode('quick');
    focusReminderTitleInput(reminderId);
  }

  function isSameFloatingSurfaceOpen(kind: MenuFloatingSurfaceKind, reminderId?: string) {
    if (activeFloatingSurfaceRef.current !== kind) {
      return false;
    }

    if (kind === 'reminder-context') {
      return contextMenuStateRef.current?.reminderId === reminderId;
    }

    return true;
  }

  function markFloatingSurfaceOpen(kind: MenuFloatingSurfaceKind, reminderId?: string) {
    activeFloatingSurfaceRef.current = kind;
    setActiveFloatingSurface(kind);

    if (kind === 'reminder-context' && reminderId) {
      const nextContextMenuState = { reminderId };
      contextMenuStateRef.current = nextContextMenuState;
      setContextMenuState(nextContextMenuState);
      return;
    }

    contextMenuStateRef.current = null;
    setContextMenuState(null);
  }

  async function closeFloatingSurface(kind?: MenuFloatingSurfaceKind) {
    clearFloatingSurfaceState(kind);
    await window.xiabanla.closeMenuFloatingSurface(kind);
  }

  async function openFloatingSurface(request: MenuFloatingSurfaceRequest) {
    markFloatingSurfaceOpen(request.kind, request.reminderId);
    await window.xiabanla.openMenuFloatingSurface(request);
  }

  async function toggleFloatingSurface(request: MenuFloatingSurfaceRequest) {
    if (isSameFloatingSurfaceOpen(request.kind, request.reminderId)) {
      await closeFloatingSurface(request.kind);
      return;
    }

    const blockingReminder = getMissingTitleReminderForInteraction();
    const isEditingSameMissingTitleReminder = request.kind === 'reminder-context' && request.reminderId === blockingReminder?.id;
    if (request.kind !== 'title-warning' && blockingReminder && !isEditingSameMissingTitleReminder) {
      void openTitleWarningMenu(blockingReminder);
      return;
    }

    await openFloatingSurface(request);
  }

  function toggleFloatingSurfaceFromElement(
    kind: MenuFloatingSurfaceKind,
    element: Element,
    options: Omit<MenuFloatingSurfaceRequest, 'kind' | 'anchorRect'> = {}
  ) {
    return toggleFloatingSurface({
      kind,
      anchorRect: getElementAnchorRect(element),
      ...options
    });
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

  function consumePanelClickAfterTitleWarningClose(event: React.MouseEvent<HTMLElement>) {
    if (!isTitleWarningOutsideCloseSuppressed()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressTitleWarningExitUntilRef.current = 0;
  }

  return (
    <main
      className={menuShellClassName}
      onMouseDownCapture={(event) => {
        void window.xiabanla.keepMenuPanelOpen();
        closeFloatingSurfaceFromPanelPointer(event);
      }}
      onClickCapture={consumePanelClickAfterTitleWarningClose}
    >
      <section className={menuPanelClassName}>
        <header className="menu-header">
          <h1>下班啦</h1>
          <p>一个全屏提醒工具</p>
        </header>

        <section className="off-work-section">
          {visibleOffWorkReminder ? (
            <OffWorkReminderItem
              reminder={visibleOffWorkReminder}
              now={now}
              expanded={offWorkExpanded}
              adding={Boolean(offWorkDraft)}
              defaultMessageDrafts={defaultMessageDrafts}
              defaultMessagesSaving={defaultMessagesSaving}
              onCollapse={collapseOffWorkExpandedCard}
              onToggle={() => {
                if (blockOtherInteractionWhenReminderTitleMissing()) {
                  return;
                }
                if (offWorkDraft) {
                  cancelOffWorkDraft();
                  return;
                }
                setExpandedMode('full');
                setExpandedId((current) => (current === visibleOffWorkReminder.id ? '' : visibleOffWorkReminder.id));
              }}
              onChange={(nextReminder) => {
                if (offWorkDraft) {
                  setOffWorkDraft(nextReminder);
                  return;
                }
                void saveReminder(nextReminder);
              }}
              onPreview={() => void previewOffWorkReminder(visibleOffWorkReminder)}
              onSubmitAdd={() => void submitOffWorkDraft()}
              onAddDefaultMessage={addDefaultMessageDraft}
              onUpdateDefaultMessage={updateDefaultMessageDraft}
              onDeleteDefaultMessage={deleteDefaultMessageDraft}
              onResetDefaultMessages={() => void resetDefaultMessageDrafts()}
            />
          ) : (
            <button type="button" className="menu-row primary-row" onClick={addOffWorkReminder}>添加下班提醒</button>
          )}
        </section>

        <section className="reminders-section">
          <h2>更多提醒</h2>
          <div
            className="compact-list quick-create-list"
            onMouseDown={prepareReminderBlankClick}
            onMouseOver={updateHoveredReminder}
            onMouseMove={updateHoveredReminder}
            onMouseLeave={() => setHoveredReminderId('')}
            onClick={createReminderFromBlankArea}
          >
            <Presence visible={displayedMoreReminders.length === 0}>
              {(phase) => <div className={getMotionClassName('empty-state', phase)}>暂无更多提醒</div>}
            </Presence>
            {animatedMoreReminders.map(({ key, item: reminder, phase }) => {
              const isDraft = newReminderDraft?.id === reminder.id;
              return (
              <ReminderMenuItem
                key={key}
                itemRef={(element) => registerMoreReminderElement(key, element)}
                className={getListMotionClassName('reminder-menu-item', phase)}
                reminder={reminder}
                workdayReminder={offWorkReminder}
                now={now}
                isDraft={isDraft}
                isHovered={hoveredReminderId === reminder.id}
                expandedMode={expandedId === reminder.id ? expandedMode : null}
                onQuickEdit={() => {
                  openReminderQuickEdit(reminder);
                }}
                onCloseQuickEdit={() => {
                  finishQuickEdit(reminder.id);
                }}
                onCommitQuickEdit={commitQuickEdit}
                onChange={(nextReminder) => {
                  if (isDraft) {
                    updateNewReminderDraft(nextReminder);
                    return;
                  }
                  void saveReminder(nextReminder);
                }}
                onOpenMenu={(event, source) => openReminderContextMenu(reminder, event, source)}
              />
              );
            })}
          </div>
        </section>

        <div className="settings-anchor">
          <button
            className={activeFloatingSurface === 'settings' ? 'icon-button floating-surface-toggle selected' : 'icon-button floating-surface-toggle'}
            type="button"
            disabled={offWorkExpanded}
            onClick={(event) => {
              event.stopPropagation();
              void toggleFloatingSurfaceFromElement('settings', event.currentTarget, {
                placement: 'bottom-right'
              });
            }}
            aria-label="设置"
            title="设置"
          >
            <SettingsIcon />
          </button>
        </div>

        <footer className="menu-footer">
          <div className="external-sync-anchor">
            <button
              className={activeFloatingSurface === 'external-sync' ? 'icon-button footer-icon-button floating-surface-toggle selected' : 'icon-button footer-icon-button floating-surface-toggle'}
              type="button"
              onClick={(event) => void toggleExternalPanel(event.currentTarget)}
              aria-controls="external-sync-panel"
              aria-expanded={activeFloatingSurface === 'external-sync'}
              aria-label="打开或关闭同步二级菜单"
              title="打开或关闭同步二级菜单"
            >
              <LinkIcon />
            </button>
          </div>
          <button
            className={newReminderButtonClassName}
            data-reminder-draft-action
            type="button"
            onClick={toggleNewReminderDraft}
            aria-label={newReminderActionLabel}
            aria-pressed={Boolean(newReminderDraft)}
            title={newReminderActionLabel}
          >
            {newReminderDraftHasTitle ? <CheckIcon /> : <PlusIcon />}
          </button>
          </footer>
          <Presence visible={Boolean(deleteUndoBatch)}>
            {(phase) => deleteUndoBatch && (
              <div
                key={deleteUndoBatch.version}
                className={getMotionClassName('delete-undo-toast', phase)}
              >
                <button type="button" onClick={() => void restoreDeletedReminders()}>
                  <UndoIcon />
                  <span>撤销</span>
                  <span className="delete-undo-progress" aria-hidden="true" />
                </button>
              </div>
            )}
          </Presence>
      </section>
    </main>
  );
}

type ReminderOverlayProps = {
  payload?: ReminderPayload;
  onClose?: () => void;
};

type EditableReminderState = {
  reminder: Reminder;
  isDraft: boolean;
  workdayReminder?: Reminder;
};

function ReminderOverlayContent(props: {
  payload: ReminderPayload;
  eyebrow?: string;
  onDismiss: () => void;
  onEnter: () => void;
  onSnooze: (minutes: number) => void;
}) {
  const { payload, eyebrow = '全屏提醒', onDismiss, onEnter, onSnooze } = props;
  const overlayTitle = payload.title.trim() || '提醒';
  const isOffWorkPayload = payload.reminderId === OFF_WORK_REMINDER_ID || payload.reminderId.startsWith(`${OFF_WORK_REMINDER_ID}:`);
  const overlayMessage = isOffWorkPayload ? (payload.message.trim() || overlayTitle) : overlayTitle;
  const overlaySubtitle = isOffWorkPayload && overlayMessage !== overlayTitle ? overlayTitle : '';
  const elapsedLabel = useElapsedReminderLabel();
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  const [customSnoozeDraft, setCustomSnoozeDraft] = useState('10');
  const customSnoozeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!customSnoozeOpen) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      customSnoozeInputRef.current?.focus();
      customSnoozeInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [customSnoozeOpen]);

  function submitCustomSnooze() {
    const minutes = Number.parseInt(customSnoozeDraft, 10);
    if (!Number.isFinite(minutes) || minutes < 1) {
      customSnoozeInputRef.current?.focus();
      return;
    }
    onSnooze(Math.min(minutes, 24 * 60));
  }

  return (
    <div className="overlay-content">
      <span className="overlay-eyebrow">
        <BellIcon />
        {eyebrow}
      </span>
      <h1>{overlayMessage}</h1>
      {overlaySubtitle && <p className="overlay-title">{overlaySubtitle}</p>}
      <time>{payload.currentTime}</time>
      <strong className="overlay-elapsed">{elapsedLabel}</strong>
      <div className="overlay-primary-actions" aria-label="提醒操作">
        <button type="button" className="overlay-icon-button" aria-label="关闭提醒" onClick={onDismiss}>
          <CloseIcon />
        </button>
        <button type="button" className="overlay-icon-button" aria-label={`进入${overlayTitle}`} onClick={onEnter}>
          <ArrowUpRightIcon />
        </button>
      </div>
      <div className="overlay-snooze-actions" aria-label="稍后提醒">
        <span>稍后提醒</span>
        <button type="button" onClick={() => onSnooze(1)}>1分钟</button>
        <button type="button" onClick={() => onSnooze(5)}>5分钟</button>
        {customSnoozeOpen ? (
          <form
            className="overlay-custom-snooze"
            aria-label="自定义稍后提醒分钟数"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustomSnooze();
            }}
          >
            <input
              ref={customSnoozeInputRef}
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              value={customSnoozeDraft}
              aria-label="稍后提醒分钟数"
              onChange={(event) => setCustomSnoozeDraft(event.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onDismiss();
                }
              }}
            />
            <button type="submit">分钟</button>
          </form>
        ) : (
          <button
            type="button"
            className="overlay-more-button"
            aria-label="手动输入稍后提醒分钟数"
            onClick={() => setCustomSnoozeOpen(true)}
          >
            <MoreIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function useElapsedReminderLabel() {
  const startedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtRef.current) / 1_000));
  if (elapsedSeconds < 60) {
    return elapsedSeconds <= 0 ? '刚刚' : `${elapsedSeconds}秒前`;
  }

  return `${Math.floor(elapsedSeconds / 60)}分钟前`;
}

function BellIcon() {
  return (
    <svg className="overlay-small-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 17.2a2.2 2.2 0 0 0 2.04-1.38H7.96A2.2 2.2 0 0 0 10 17.2Z" />
      <path d="M4.3 13.75c1.1-.9 1.36-1.92 1.36-4.38a4.35 4.35 0 0 1 8.68 0c0 2.46.26 3.48 1.36 4.38.38.31.16.93-.33.93H4.63c-.49 0-.71-.62-.33-.93Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="overlay-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg className="overlay-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 16 16 8M10 8h6v6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="overlay-more-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.7 12h.1M12 12h.1M17.3 12h.1" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg className="undo-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M7.1 4.1 3.8 7.4l3.3 3.3" />
      <path d="M4.1 7.4h6.3a3.4 3.4 0 1 1 0 6.8H8.9" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 0 1-2.69 2.69l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 0 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.5 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 0 1-2.69-2.69l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.47-.97H3.13a1.9 1.9 0 0 1 0-3.8h.09a1.6 1.6 0 0 0 1.5-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 0 1 2.69-2.69l.06.06a1.6 1.6 0 0 0 1.76.32h.08A1.6 1.6 0 0 0 9.9 3.3v-.17a1.9 1.9 0 0 1 3.8 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 0 1 2.69 2.69l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 0 1 0 3.8h-.09A1.6 1.6 0 0 0 19.4 15Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="settings-description-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5 19 6v5.2c0 4.2-2.64 7.38-7 9.3-4.36-1.92-7-5.1-7-9.3V6l7-2.5Z" />
      <path d="m9.4 11.9 1.7 1.7 3.7-4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 6v12" />
      <path d="M16 6v12" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.5 12s3.1-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.1 5.5-8.5 5.5S3.5 12 3.5 12Z" />
      <path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" />
    </svg>
  );
}

type OffWorkReminderItemProps = {
  reminder: Reminder;
  now: Date;
  expanded: boolean;
  adding?: boolean;
  defaultMessageDrafts: ReminderMessage[];
  defaultMessagesSaving: boolean;
  onChange: (reminder: Reminder) => void;
  onCollapse: () => void;
  onPreview: () => void;
  onSubmitAdd?: () => void;
  onToggle: () => void;
  onAddDefaultMessage: () => void;
  onUpdateDefaultMessage: (id: string, patch: Partial<ReminderMessage>) => void;
  onDeleteDefaultMessage: (id: string) => void;
  onResetDefaultMessages: () => void;
};

function OffWorkReminderItem(props: OffWorkReminderItemProps) {
  const {
    reminder,
    now,
    expanded,
    adding = false,
    defaultMessageDrafts,
    defaultMessagesSaving,
    onChange,
    onCollapse,
    onPreview,
    onSubmitAdd,
    onToggle,
    onAddDefaultMessage,
    onUpdateDefaultMessage,
    onDeleteDefaultMessage,
    onResetDefaultMessages
  } = props;
  const todayOverrideLabel = getTodayOverrideLabel(reminder);
  const countdownState = getOffWorkCountdownState(reminder, now);
  const reminderNotifyText = formatReminderNotifyTime(reminder, now);
  const { activeNestedKind, openSubmenu, closeSubmenu } = useFloatingSubmenu();
  const [advanceMinutesInput, setAdvanceMinutesInput] = useState(String(reminder.advanceMinutes));

  useEffect(() => {
    setAdvanceMinutesInput(String(reminder.advanceMinutes));
  }, [reminder.id, reminder.advanceMinutes]);

  function update(patch: Partial<Reminder>) {
    onChange({ ...reminder, ...patch });
  }

  function updateAdvanceMinutesInput(value: string) {
    setAdvanceMinutesInput(value);
    if (!value.trim()) {
      return;
    }

    update({ advanceMinutes: Math.max(0, Number(value) || 0) });
  }

  function commitEmptyAdvanceMinutesInputAsZero() {
    if (advanceMinutesInput.trim()) {
      return;
    }

    setAdvanceMinutesInput('0');
    if (reminder.advanceMinutes !== 0) {
      update({ advanceMinutes: 0 });
    }
  }

  function updateTodayOverride(time: string) {
    update({
      todayOverrideTime: time || undefined,
      todayOverrideDate: time ? toDateKey(new Date()) : undefined
    });
  }

  function updateTodayOverrideByOffset(offsetMinutes: number) {
    updateTodayOverride(shiftTimeByMinutes(reminder.dailyTime, offsetMinutes));
  }

  function openTertiaryMenu(kind: MenuFloatingSurfaceKind, event: React.SyntheticEvent<HTMLElement>) {
    openSubmenu(kind, event, {
      reminderId: reminder.id,
      placement: 'right-top'
    });
  }

  function openTodayOverrideMenu(event: React.SyntheticEvent<HTMLElement>) {
    openTertiaryMenu('today-override', event);
  }

  function openDefaultMessagesMenu(event: React.SyntheticEvent<HTMLElement>) {
    openTertiaryMenu('default-messages', event);
  }

  function updateDailyTime(dailyTime: string) {
    update({
      dailyTime,
      todayOverrideTime: undefined,
      todayOverrideDate: undefined
    });
  }

  function pauseReminder() {
    update({ enabled: false });
    onCollapse();
  }

  function saveAndExitExpandedEdit(event: React.KeyboardEvent<HTMLElement>) {
    if (isInputMethodComposing(event) || (event.key !== 'Enter' && event.key !== 'Escape')) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('input')) {
      return;
    }

    event.preventDefault();
    if (adding || onSubmitAdd) {
      onSubmitAdd?.();
      return;
    }
    onCollapse();
  }

  return (
    <article
      className={[
        'reminder-menu-item',
        'off-work-item',
        expanded ? 'off-work-item-expanded' : '',
        adding ? 'off-work-item-adding' : ''
      ].filter(Boolean).join(' ')}
      data-reminder-id={reminder.id}
    >
      <div className="countdown-card">
        <button type="button" className="countdown-card-main" onClick={onToggle}>
          <span className="countdown-label">下班倒计时</span>
          <span className="countdown-main-row">
            <RollingCountdown value={countdownState.text} />
            {countdownState.showTimeMeta && (
              <span className="countdown-meta">
                <small>{formatTodayOffWorkTime(reminder, now)}</small>
                {reminderNotifyText && <small>{reminderNotifyText}</small>}
              </span>
            )}
          </span>
        </button>
      </div>
      <Presence visible={expanded}>
        {(phase) => (
          <div
            className={getMotionClassName('submenu', phase)}
            onKeyDown={saveAndExitExpandedEdit}
            onMouseMove={(event) => closeFloatingSubmenusFromParentPointer(event, closeSubmenu)}
          >
          <div className="submenu-grid">
            <label>
              下班时间
              <TimeField value={reminder.dailyTime} onChange={updateDailyTime} />
            </label>
            <label>
              提前提醒
              <span className="unit-input">
                <input
                  type="number"
                  min="0"
                  value={advanceMinutesInput}
                  onChange={(event) => updateAdvanceMinutesInput(event.target.value)}
                  onBlur={commitEmptyAdvanceMinutesInputAsZero}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === 'Escape') {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <span>分钟</span>
              </span>
            </label>
          </div>

          <ReminderRepeatPicker reminder={reminder} onChange={(patch) => update(patch)} />

          <div className="tertiary-menu-wrap">
            <button
              type="button"
              className={['menu-row compact-menu-row', activeNestedKind === 'today-override' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
              onPointerEnter={openTodayOverrideMenu}
              onMouseMove={openTodayOverrideMenu}
              onFocus={openTodayOverrideMenu}
              onClick={openTodayOverrideMenu}
            >
              <span>{todayOverrideLabel}</span>
              <small>{reminder.todayOverrideTime || '未设置'}</small>
            </button>
          </div>

          <div className="tertiary-menu-wrap">
            <button
              type="button"
              className={['menu-row compact-menu-row', activeNestedKind === 'default-messages' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
              onPointerEnter={openDefaultMessagesMenu}
              onMouseMove={openDefaultMessagesMenu}
              onFocus={openDefaultMessagesMenu}
              onClick={openDefaultMessagesMenu}
            >
              <span>下班文案</span>
              <small>{defaultMessageDrafts.length} 条</small>
            </button>
          </div>

          {adding && (
            <div className="submenu-actions">
              <button type="button" className="primary-card-action" onClick={onSubmitAdd}>添加</button>
            </div>
          )}
        </div>
        )}
      </Presence>
      {expanded && !adding && (
        <div className="off-work-card-actions">
          <button type="button" className="menu-action-button" onClick={pauseReminder}>
            <PauseIcon />
            <span>暂停提醒</span>
          </button>
          <button type="button" className="menu-action-button" onClick={onPreview}>
            <PreviewIcon />
            <span>预览提醒</span>
          </button>
        </div>
      )}
    </article>
  );

}

type ReminderRepeatPickerProps = {
  reminder: Reminder;
  workdayReminder?: Reminder;
  allowNoRepeat?: boolean;
  alternateDefaultDays?: number[];
  onChange: (patch: Partial<Reminder>) => void;
};

function ReminderRepeatPicker(props: ReminderRepeatPickerProps) {
  const { reminder, workdayReminder, allowNoRepeat = false, alternateDefaultDays = DEFAULT_WORK_WEEK_DAYS, onChange } = props;
  const repeatEnabled = !allowNoRepeat || reminder.repeatRule !== 'once';
  const useAlternateWeeks = Boolean(reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks');
  const workdayRepeatDefaults = getWorkdayRepeatDefaults(workdayReminder, alternateDefaultDays);
  const fallbackWeeklyDays = repeatEnabled && reminder.weeklyDays?.length ? reminder.weeklyDays : workdayRepeatDefaults.weeklyDays;
  const fallbackAlternateWeekDays = useAlternateWeeks && reminder.alternateWeekDays?.length ? reminder.alternateWeekDays : workdayRepeatDefaults.alternateWeekDays;
  const fallbackAlternateNextWeekDays = useAlternateWeeks && reminder.alternateNextWeekDays?.length ? reminder.alternateNextWeekDays : workdayRepeatDefaults.alternateNextWeekDays;
  const alternateWeekAnchorDate = reminder.alternateWeekAnchorDate || workdayRepeatDefaults.alternateWeekAnchorDate || toDateKey(new Date());
  const alternateWeekReference = { ...reminder, alternateWeekAnchorDate };
  const currentWeekSlot = getAlternateWeekCycleSlot(alternateWeekReference, new Date());
  const nextWeekSlot = currentWeekSlot === 'anchor' ? 'next' : 'anchor';
  const currentWeekDays = currentWeekSlot === 'anchor' ? fallbackAlternateWeekDays : fallbackAlternateNextWeekDays;
  const nextWeekDays = nextWeekSlot === 'anchor' ? fallbackAlternateWeekDays : fallbackAlternateNextWeekDays;

  function updateRepeatEnabled(nextRepeatEnabled: boolean) {
    if (!nextRepeatEnabled) {
      onChange({
        repeatRule: 'once',
        useAlternateWeeks: false,
        weeklyDays: fallbackWeeklyDays,
        scheduledDate: reminder.scheduledDate || toDateKey(new Date())
      });
      return;
    }
    updateRepeatPatch({
      useAlternateWeeks: false,
      weeklyDays: fallbackWeeklyDays
    });
  }

  function updateRepeatPatch(patch: Partial<Reminder>) {
    const nextReminder: Reminder = {
      ...reminder,
      weeklyDays: fallbackWeeklyDays,
      ...patch,
      repeatRule: 'weekly'
    };
    onChange({
      ...patch,
      repeatRule: 'weekly',
      weeklyDays: nextReminder.weeklyDays,
      scheduledDate: getNextRepeatDateKey(nextReminder)
    });
  }

  function toggleWeekDay(day: number) {
    updateRepeatPatch({
      weeklyDays: toggleDay(fallbackWeeklyDays, day),
      useAlternateWeeks: false
    });
  }

  function toggleAlternateDay(week: 'current' | 'next', day: number) {
    const slot = week === 'current' ? currentWeekSlot : nextWeekSlot;
    if (slot === 'anchor') {
      updateRepeatPatch({
        useAlternateWeeks: true,
        alternateWeekAnchorDate,
        alternateWeekDays: toggleDay(fallbackAlternateWeekDays, day),
        alternateNextWeekDays: fallbackAlternateNextWeekDays
      });
      return;
    }
    updateRepeatPatch({
      useAlternateWeeks: true,
      alternateWeekAnchorDate,
      alternateWeekDays: fallbackAlternateWeekDays,
      alternateNextWeekDays: toggleDay(fallbackAlternateNextWeekDays, day)
    });
  }

  function updateAlternateWeeks(nextUseAlternateWeeks: boolean) {
    updateRepeatPatch({
      useAlternateWeeks: nextUseAlternateWeeks,
      alternateWeekAnchorDate: nextUseAlternateWeeks ? alternateWeekAnchorDate : reminder.alternateWeekAnchorDate,
      alternateWeekDays: fallbackAlternateWeekDays,
      alternateNextWeekDays: fallbackAlternateNextWeekDays
    });
  }

  return (
    <section className="repeat-picker">
      <div className="repeat-heading">
        <span>重复</span>
        <div className="repeat-switches">
          {allowNoRepeat && (
            <label className="switch-row">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(event) => updateRepeatEnabled(event.target.checked)}
              />
              <span>重复</span>
            </label>
          )}
          <label className="switch-row">
            <input
              type="checkbox"
              checked={useAlternateWeeks}
              disabled={!repeatEnabled}
              onChange={(event) => updateAlternateWeeks(event.target.checked)}
            />
            <span>大小周</span>
          </label>
        </div>
      </div>

      {repeatEnabled && useAlternateWeeks ? (
        <div className="alternate-week-rows">
          <WeekdayPicker
            label="本周"
            selectedDays={currentWeekDays}
            onToggle={(day) => toggleAlternateDay('current', day)}
          />
          <WeekdayPicker
            label="下周"
            selectedDays={nextWeekDays}
            onToggle={(day) => toggleAlternateDay('next', day)}
          />
        </div>
      ) : repeatEnabled ? (
        <WeekdayPicker selectedDays={fallbackWeeklyDays} onToggle={toggleWeekDay} />
      ) : (
        <div className="repeat-empty-state">不重复</div>
      )}
    </section>
  );
}

type WeekdayPickerProps = {
  label?: string;
  selectedDays: number[];
  onToggle: (day: number) => void;
};

function WeekdayPicker(props: WeekdayPickerProps) {
  const { label, selectedDays, onToggle } = props;
  return (
    <div className={label ? 'weekday-line' : 'weekday-line single-weekday-line'}>
      {label && <span>{label}</span>}
      <div className="weekday-row">
        {WEEK_DAYS.map((day) => (
          <button
            type="button"
            key={day.value}
            className={selectedDays.includes(day.value) ? 'selected' : ''}
            onClick={() => onToggle(day.value)}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type TimeFieldProps = {
  value: string;
  placeholder?: string;
  allowEmpty?: boolean;
  commitOnValidChange?: boolean;
  onChange: (value: string) => void | Promise<void>;
  onKeyboardCommit?: (value: string) => void | Promise<void>;
};

type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyboardCommit?: () => void;
};

function DateField(props: DateFieldProps) {
  const { value, onChange, onKeyboardCommit } = props;
  const [draft, setDraft] = useState(formatDateInputValue(value));
  const lastCommittedRef = useRef(value);
  const inputMethodGuard = useInputMethodGuard();
  const placeholder = formatDateInputValue(lastCommittedRef.current);

  useEffect(() => {
    setDraft(formatDateInputValue(value));
    lastCommittedRef.current = value;
  }, [value]);

  function commitNormalizedDate(normalizedDate: string) {
    setDraft(formatDateInputValue(normalizedDate));
    if (normalizedDate === lastCommittedRef.current) {
      return;
    }
    lastCommittedRef.current = normalizedDate;
    onChange(normalizedDate);
  }

  function commit(nextDraft: string) {
    if (!nextDraft.trim()) {
      setDraft(formatDateInputValue(lastCommittedRef.current));
      return false;
    }

    const normalizedDate = normalizeDateInput(nextDraft);
    if (!normalizedDate) {
      setDraft(formatDateInputValue(lastCommittedRef.current));
      return false;
    }

    commitNormalizedDate(normalizedDate);
    return true;
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(limitDateDraft(event.target.value))}
      onBlur={() => commit(draft)}
      onCompositionStart={inputMethodGuard.markCompositionStart}
      onCompositionEnd={inputMethodGuard.markCompositionEnd}
      onKeyDown={(event) => {
        if (inputMethodGuard.shouldIgnoreEnter(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          commit(draft);
          onKeyboardCommit?.();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function TimeField(props: TimeFieldProps) {
  const { value, placeholder, allowEmpty = false, commitOnValidChange = false, onChange, onKeyboardCommit } = props;
  const [draft, setDraft] = useState(formatTimeInputValue(value));
  const lastCommittedRef = useRef(formatTimeInputValue(value));
  const keyboardCommitPendingRef = useRef(false);
  const inputMethodGuard = useInputMethodGuard();
  const placeholderText = formatTimeInputValue(placeholder ?? lastCommittedRef.current);

  useEffect(() => {
    const formattedValue = formatTimeInputValue(value);
    setDraft(formattedValue);
    lastCommittedRef.current = formattedValue;
  }, [value]);

  async function commitNormalizedTime(normalizedTime: string) {
    setDraft(normalizedTime);
    if (normalizedTime === lastCommittedRef.current) {
      return normalizedTime;
    }
    lastCommittedRef.current = normalizedTime;
    await onChange(normalizedTime);
    return normalizedTime;
  }

  async function commit(nextDraft: string) {
    if (!nextDraft.trim()) {
      setDraft(lastCommittedRef.current);
      return null;
    }

    const normalizedTime = normalizeTimeInput(nextDraft);
    if (!normalizedTime) {
      setDraft(lastCommittedRef.current);
      return null;
    }

    return commitNormalizedTime(normalizedTime);
  }

  function updateDraft(nextValue: string) {
    const nextDraft = limitTimeDraft(nextValue);
    setDraft(nextDraft);

    if (!commitOnValidChange) {
      return;
    }

    if (!nextDraft.trim()) {
      if (allowEmpty) {
        void commitNormalizedTime('');
      }
      return;
    }

    const normalizedTime = normalizeTimeInput(nextDraft);
    if (normalizedTime && isTimeDraftReadyToCommit(nextDraft)) {
      void commitNormalizedTime(normalizedTime);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholderText}
      value={draft}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={() => void commit(draft)}
      onCompositionStart={inputMethodGuard.markCompositionStart}
      onCompositionEnd={inputMethodGuard.markCompositionEnd}
      onKeyDown={(event) => {
        if (inputMethodGuard.shouldIgnoreEnter(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (keyboardCommitPendingRef.current) {
            return;
          }
          keyboardCommitPendingRef.current = true;
          const shouldNotifyKeyboardCommit = event.key === 'Enter' || event.key === 'Escape';
          void commit(draft).then((committedValue) => {
            if (shouldNotifyKeyboardCommit && committedValue) {
              return onKeyboardCommit?.(committedValue);
            }
            return undefined;
          }).finally(() => {
            keyboardCommitPendingRef.current = false;
          });
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type RollingCountdownProps = {
  value: string;
};

function RollingCountdown(props: RollingCountdownProps) {
  const { value } = props;
  const shouldAnimateDigits = /^\d{2}:\d{2}:\d{2}$/.test(value);

  if (!shouldAnimateDigits) {
    return <strong className="rolling-countdown">{value}</strong>;
  }

  return (
    <strong className="rolling-countdown" aria-label={value}>
      {value.split('').map((char, index) => (
        <span className={/\d/.test(char) ? 'rolling-digit-frame' : 'rolling-static-char'} key={`${index}-${char}`}>
          <span className={/\d/.test(char) ? 'rolling-digit' : ''}>{char}</span>
        </span>
      ))}
    </strong>
  );
}

type ReminderMenuItemProps = {
  className?: string;
  itemRef?: (element: HTMLElement | null) => void;
  reminder: Reminder;
  workdayReminder?: Reminder;
  now: Date;
  isDraft?: boolean;
  isHovered?: boolean;
  expandedMode: ReminderExpansionMode | null;
  onChange: (reminder: Reminder) => void;
  onQuickEdit: () => void;
  onCloseQuickEdit: () => void;
  onCommitQuickEdit: (reminder: Reminder) => void;
  onOpenMenu: (event: React.MouseEvent, source: 'pointer' | 'info') => void;
};

function ReminderMenuItem(props: ReminderMenuItemProps) {
  const {
    className = 'reminder-menu-item',
    itemRef,
    reminder,
    workdayReminder,
    now,
    isDraft = false,
    isHovered = false,
    expandedMode,
    onChange,
    onQuickEdit,
    onCloseQuickEdit,
    onCommitQuickEdit,
    onOpenMenu
  } = props;
  const currentReminderRef = useRef(reminder);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleComposingRef = useRef(false);
  const [titleDraft, setTitleDraft] = useState(reminder.name);
  const inputMethodGuard = useInputMethodGuard();
  const itemClassName = [
    className,
    isDraft ? 'reminder-menu-item-draft' : '',
    isHovered ? 'reminder-menu-item-hovered' : '',
    expandedMode === 'quick' ? 'reminder-menu-item-quick-edit' : ''
  ].filter(Boolean).join(' ');
  const isPastDue = isReminderPastDue(reminder, now);
  const ruleClassName = isPastDue ? 'task-deadline-overdue' : '';
  const isExternalSynced = Boolean(reminder.linkedExternalSource);

  useEffect(() => {
    currentReminderRef.current = reminder;
  }, [reminder]);

  useEffect(() => {
    if (titleComposingRef.current) {
      return;
    }
    setTitleDraft(reminder.name);
  }, [reminder.name]);

  useEffect(() => {
    if (expandedMode !== 'quick') {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const titleInput = titleInputRef.current;
      if (!titleInput) {
        return;
      }

      titleInput.focus();
      const cursorPosition = titleInput.value.length;
      titleInput.setSelectionRange(cursorPosition, cursorPosition);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [expandedMode, reminder.id]);

  function update(patch: Partial<Reminder>) {
    const nextReminder = { ...currentReminderRef.current, ...patch };
    currentReminderRef.current = nextReminder;
    onChange(nextReminder);
  }

  function updateTitleDraft(nextTitle: string) {
    setTitleDraft(nextTitle);

    if (titleComposingRef.current) {
      return;
    }

    update({ name: nextTitle });
  }

  function finishTitleComposition(event: React.CompositionEvent<HTMLInputElement>) {
    titleComposingRef.current = false;
    const nextTitle = event.currentTarget.value;
    setTitleDraft(nextTitle);
    update({ name: nextTitle });
  }

  function handleQuickEditKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (inputMethodGuard.shouldIgnoreEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCommitQuickEdit(currentReminderRef.current);
    }
  }

  function commitQuickFieldFromKeyboard() {
    if (!currentReminderRef.current.name.trim()) {
      focusTitleInput();
      return;
    }

    onCommitQuickEdit(currentReminderRef.current);
  }

  function focusTitleInput() {
    window.requestAnimationFrame(() => {
      const titleInput = titleInputRef.current;
      if (!titleInput) {
        return;
      }

      titleInput.focus();
      const cursorPosition = titleInput.value.length;
      titleInput.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function toggleCompletionAndExitEdit() {
    const nextReminder = {
      ...currentReminderRef.current,
      ...createCompletionPatch(currentReminderRef.current)
    };
    currentReminderRef.current = nextReminder;
    onChange(nextReminder);

    if (expandedMode === 'quick') {
      onCommitQuickEdit(nextReminder);
    }
  }

  function closeQuickEditFromEmptyTitle(event: React.MouseEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (!input.value.trim()) {
      return;
    }

    const styles = window.getComputedStyle(input);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.font = styles.font;
    const textWidth = context.measureText(input.value).width;
    const clickX = event.clientX - input.getBoundingClientRect().left;
    const textEndX = parseFloat(styles.paddingLeft || '0') + textWidth + 8;

    // 标题输入框本身铺满整行，点击文字后的空白区域时按 macOS 提醒事项 App 的习惯收起编辑。
    if (clickX > textEndX) {
      event.preventDefault();
      event.stopPropagation();
      onCloseQuickEdit();
    }
  }

  return (
    <article
      ref={itemRef}
      className={itemClassName}
      data-reminder-id={reminder.id}
      onCompositionStart={inputMethodGuard.markCompositionStart}
      onCompositionEnd={inputMethodGuard.markCompositionEnd}
      onContextMenu={(event) => {
        if (!isDraft) {
          onOpenMenu(event, 'pointer');
        }
      }}
    >
      <div className="task-row">
        <button
          className={reminder.completed ? 'task-check completed' : 'task-check'}
          aria-label={reminder.completed ? '标为未完成' : '标为已完成'}
          disabled={isExternalSynced}
          onClick={toggleCompletionAndExitEdit}
        />
        <div
          className={isExternalSynced ? 'task-content task-content-readonly' : 'task-content'}
          onClick={isExternalSynced ? undefined : onQuickEdit}
        >
          {expandedMode === 'quick' ? (
            <input
              ref={titleInputRef}
              className="inline-title-input"
              value={titleDraft}
              placeholder={isDraft ? '请输入标题' : undefined}
              onChange={(event) => updateTitleDraft(event.target.value)}
              onCompositionStart={() => {
                titleComposingRef.current = true;
              }}
              onCompositionEnd={finishTitleComposition}
              onMouseDown={closeQuickEditFromEmptyTitle}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={handleQuickEditKeyDown}
              aria-label="提醒标题"
            />
          ) : (
            <span className="task-title-line">
              <span className={isDraft && !reminder.name.trim() ? 'task-title-placeholder' : ''}>
                {reminder.name || (isDraft ? '请输入标题' : '')}
              </span>
              {isExternalSynced && <span className="source-badge">本机同步</span>}
            </span>
          )}
          {expandedMode !== 'quick' && <small className={ruleClassName}>{formatTaskRule(reminder, now, workdayReminder)}</small>}
        </div>
        <button
          className="task-info-button floating-surface-toggle"
          onClick={(event) => onOpenMenu(event, 'info')}
          aria-label={isExternalSynced ? '查看同步信息' : '编辑提醒'}
        >
          i
        </button>
      </div>
      <Presence visible={expandedMode === 'quick'}>
        {(phase) => (
        <div className={getMotionClassName('task-quick-editor', phase)} onKeyDown={handleQuickEditKeyDown}>
          <div className="quick-field-row">
            <label className="icon-field">
              <span className="field-icon date-icon" aria-hidden="true" />
              <span className="sr-only">日期</span>
              <DateField
                value={getReminderDueDateKey(reminder, now) || toDateKey(now)}
                onChange={(scheduledDate) => update(createDueDatePatch(reminder, scheduledDate))}
                onKeyboardCommit={commitQuickFieldFromKeyboard}
              />
            </label>
            <label className="icon-field">
              <span className="field-icon time-icon" aria-hidden="true" />
              <span className="sr-only">时间</span>
              {/* 快速编辑会先响应外部 mousedown 收起面板，合法时间需要先进入提醒对象，避免输入框卸载时丢草稿。 */}
              <TimeField
                value={reminder.dailyTime}
                commitOnValidChange
                onChange={(dailyTime) => update({ dailyTime })}
                onKeyboardCommit={commitQuickFieldFromKeyboard}
              />
            </label>
          </div>
        </div>
        )}
      </Presence>
    </article>
  );
}

function ReminderOverlay(props: ReminderOverlayProps = {}) {
  const { payload: controlledPayload, onClose } = props;
  const [payload, setPayload] = useState<ReminderPayload | null>(controlledPayload ?? null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (controlledPayload) {
      setPayload(controlledPayload);
      return undefined;
    }

    void window.xiabanla.getReminderPayload().then(setPayload);
    const unsubscribe = window.xiabanla.onReminderPayloadUpdated((nextPayload) => {
      setPayload(nextPayload);
    });
    return unsubscribe;
  }, [controlledPayload]);

  const closeWithAnimation = useCallback((action: () => Promise<void>) => {
    if (closing) {
      return;
    }

    setClosing(true);
    window.setTimeout(() => {
      void action().finally(onClose);
    }, MENU_PANEL_ANIMATION_MS);
  }, [closing, onClose]);

  const closeReminder = useCallback(() => {
    if (!payload) {
      return;
    }

    closeWithAnimation(() => window.xiabanla.dismissReminder(payload.reminderId));
  }, [closeWithAnimation, payload]);

  const enterReminder = useCallback(() => {
    if (!payload) {
      return;
    }

    closeWithAnimation(() => window.xiabanla.enterReminder(payload.reminderId));
  }, [closeWithAnimation, payload]);

  useReminderQuickDismiss(Boolean(payload) && !closing, closeReminder);

  if (!payload) {
    return <div className="overlay loading">正在准备提醒...</div>;
  }

  return (
    <main className={closing ? 'overlay overlay-closing' : 'overlay'}>
      <div className="overlay-content-hit-area">
        <ReminderOverlayContent
          payload={payload}
          onDismiss={closeReminder}
          onEnter={enterReminder}
          onSnooze={(minutes) => closeWithAnimation(() => window.xiabanla.snoozeReminder(payload.reminderId, minutes))}
        />
      </div>
    </main>
  );
}

function createReminder(primaryDisplayId?: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: createClientId('reminder'),
    name: DEFAULT_NEW_REMINDER_NAME,
    createdAt: new Date().toISOString(),
    enabled: true,
    completed: false,
    completedAt: undefined,
    repeatRule: 'once',
    weeklyDays: [...DEFAULT_WORK_WEEK_DAYS],
    useAlternateWeeks: false,
    alternateWeekDays: [],
    alternateNextWeekDays: [],
    scheduledDate: toDateKey(new Date()),
    dailyTime: '18:00',
    advanceMinutes: 0,
    todayOverrideDate: undefined,
    repeatUntilDismissed: false,
    repeatIntervalMinutes: 5,
    messages: [{ id: createClientId('message'), text: '准备下班', enabled: true }],
    selectedDisplayIds: primaryDisplayId ? [primaryDisplayId] : [],
    ...overrides
  };
}

function createCompletionPatch(reminder: Reminder): Partial<Reminder> {
  const completed = !reminder.completed;
  return {
    completed,
    completedAt: completed ? new Date().toISOString() : undefined
  };
}

function getHoveredReminderIdFromTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const hoveredItem = element?.closest<HTMLElement>('.reminder-menu-item[data-reminder-id]');
  return hoveredItem?.dataset.reminderId || '';
}

function getPointerPosition(event: React.MouseEvent) {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function getContextMenuContainerRect() {
  const shell = document.querySelector('.menu-shell');
  if (shell instanceof HTMLElement) {
    return shell.getBoundingClientRect();
  }

  return {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function getPointerContextMenuPosition(pointerPosition: { x: number; y: number }) {
  const containerRect = getContextMenuContainerRect();
  const localPointerPosition = {
    x: pointerPosition.x - containerRect.left,
    y: pointerPosition.y - containerRect.top
  };

  return {
    x: localPointerPosition.x + CONTEXT_MENU_POINTER_GAP,
    // 右键菜单固定从鼠标右下角展开；弹窗 transform 下需先转换为弹窗内坐标。
    y: localPointerPosition.y + CONTEXT_MENU_POINTER_GAP
  };
}

function cloneReminder(reminder: Reminder): Reminder {
  return {
    ...reminder,
    weeklyDays: reminder.weeklyDays ? [...reminder.weeklyDays] : undefined,
    alternateWeekDays: reminder.alternateWeekDays ? [...reminder.alternateWeekDays] : undefined,
    alternateNextWeekDays: reminder.alternateNextWeekDays ? [...reminder.alternateNextWeekDays] : undefined,
    messages: reminder.messages.map((message) => ({ ...message })),
    selectedDisplayIds: [...reminder.selectedDisplayIds],
    linkedExternalSource: reminder.linkedExternalSource ? { ...reminder.linkedExternalSource } : undefined
  };
}

function isNewReminderDraftMeaningfullyConfigured(reminder: Reminder, initialReminder: Reminder | null) {
  if (!initialReminder) {
    return false;
  }

  return JSON.stringify(getDraftConfigurationSnapshot(reminder)) !== JSON.stringify(getDraftConfigurationSnapshot(initialReminder));
}

function isNewReminderDraftEdited(reminder: Reminder, initialReminder: Reminder | null) {
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

function getTitleWarningAnchorElement(reminderId: string) {
  const reminderElement = getReminderMenuItemElement(reminderId);
  const infoButton = reminderElement?.querySelector<HTMLElement>('.task-info-button');
  if (infoButton) {
    return infoButton;
  }
  if (reminderElement) {
    return reminderElement;
  }

  return document.querySelector<HTMLElement>('[data-reminder-draft-action]');
}

function focusReminderTitleInput(reminderId: string) {
  window.requestAnimationFrame(() => {
    const input = getReminderMenuItemElement(reminderId)?.querySelector<HTMLInputElement>('.inline-title-input');
    if (!input) {
      return;
    }

    input.focus();
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
  });
}

function getReminderMenuItemElement(reminderId: string) {
  return document.querySelector<HTMLElement>(`[data-reminder-id="${escapeCssAttributeValue(reminderId)}"]`);
}

function escapeCssAttributeValue(value: string) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }

  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createClientId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadThemeMode(): ThemeMode {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function saveThemeMode(nextThemeMode: ThemeMode) {
  window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode);
  window.dispatchEvent(new CustomEvent(THEME_MODE_CHANGED_EVENT, { detail: nextThemeMode }));
  if (typeof BroadcastChannel === 'undefined') {
    return;
  }
  const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
  channel.postMessage(nextThemeMode);
  channel.close();
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function subscribeThemeMode(callback: (themeMode: ThemeMode) => void) {
  function syncStoredThemeMode(event: StorageEvent) {
    if (event.key === THEME_STORAGE_KEY) {
      callback(loadThemeMode());
    }
  }

  function syncLocalThemeMode(event: Event) {
    if (event instanceof CustomEvent && isThemeMode(event.detail)) {
      callback(event.detail);
    }
  }

  function syncBroadcastThemeMode(event: MessageEvent) {
    if (isThemeMode(event.data)) {
      window.localStorage.setItem(THEME_STORAGE_KEY, event.data);
      callback(event.data);
    }
  }

  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(THEME_BROADCAST_CHANNEL);
  channel?.addEventListener('message', syncBroadcastThemeMode);
  window.addEventListener('storage', syncStoredThemeMode);
  window.addEventListener(THEME_MODE_CHANGED_EVENT, syncLocalThemeMode);

  return () => {
    channel?.removeEventListener('message', syncBroadcastThemeMode);
    channel?.close();
    window.removeEventListener('storage', syncStoredThemeMode);
    window.removeEventListener(THEME_MODE_CHANGED_EVENT, syncLocalThemeMode);
  };
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return toDateKey(nextDate);
}

function getNextRepeatDateKey(reminder: Reminder, fromDate = new Date()) {
  return getReminderNextDateKey(reminder, fromDate);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getCalendarMonth(dateKey?: string) {
  const date = dateKey ? parseDateKey(dateKey) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      dateKey: toDateKey(date),
      dayOfMonth: date.getDate(),
      inCurrentMonth: date.getMonth() === month.getMonth()
    };
  });
}

function formatCalendarMonth(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function parseDateKey(dateKey: string) {
  const [year = '0', month = '1', day = '1'] = dateKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateInputValue(value: string) {
  const normalizedDate = normalizeDateInput(value);
  return normalizedDate ? normalizedDate.replaceAll('-', '/') : value.replaceAll('-', '/');
}

function limitDateDraft(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 6) {
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6)}`;
  }
  if (digits.length > 4) {
    return `${digits.slice(0, 4)}/${digits.slice(4)}`;
  }
  return digits;
}

function normalizeDateInput(value: string) {
  const trimmedValue = value.trim().replaceAll('-', '/');
  const slashMatch = trimmedValue.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const compactMatch = trimmedValue.match(/^(\d{4})(\d{2})(\d{2})$/);
  const match = slashMatch || compactMatch;
  if (!match) {
    return '';
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return '';
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatTimeInputValue(value: string) {
  return normalizeTimeInput(value) || value;
}

function limitTimeDraft(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length === 3) {
    const trailingMinutes = Number(digits.slice(1));
    if (trailingMinutes <= 59) {
      return `${digits.slice(0, 1)}:${digits.slice(1)}`;
    }
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function normalizeTimeInput(value: string) {
  const trimmedValue = value.trim();
  const colonMatch = trimmedValue.match(/^(\d{1,2}):(\d{1,2})$/);
  const digitMatch = trimmedValue.match(/^\d{1,4}$/);
  if (!colonMatch && !digitMatch) {
    return '';
  }

  let hour = 0;
  let minute = 0;

  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2].padEnd(2, '0'));
  } else {
    const paddedValue = trimmedValue.padStart(4, '0');
    hour = Number(paddedValue.slice(0, 2));
    minute = Number(paddedValue.slice(2, 4));
  }

  if (hour > 23 || minute > 59) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isTimeDraftReadyToCommit(value: string) {
  const trimmedValue = value.trim();
  const digits = trimmedValue.replace(/\D/g, '');
  if (digits.length >= 4) {
    return true;
  }
  if (digits.length === 3) {
    return Number(digits.slice(0, 2)) > 23 && Number(digits.slice(1)) <= 59;
  }
  return false;
}

function nextHourTime(date: Date) {
  const next = new Date(date);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return toTime(next);
}

function findOffWorkReminder(reminders: Reminder[]) {
  return reminders.find((reminder) => reminder.id === OFF_WORK_REMINDER_ID)
    || reminders.find((reminder) => reminder.name.includes('下班'));
}

function ruleLabel(rule: RepeatRule) {
  if (rule === 'once') return '不重复';
  if (rule === 'daily') return '每天';
  if (rule === 'weekdays') return '工作日';
  if (rule === 'alternate-weeks') return '大小周';
  return '每周';
}

function formatRule(reminder: Reminder) {
  const time = reminder.todayOverrideTime || reminder.dailyTime;
  if (reminder.repeatRule === 'once') {
    return `${formatDateKey(reminder.scheduledDate)} ${time}`;
  }
  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return `大小周 ${time}`;
  }
  return `${ruleLabel(reminder.repeatRule)} ${time}`;
}

function formatTaskRule(reminder: Reminder, now: Date, workdayReminder?: Reminder) {
  const time = reminder.todayOverrideTime || reminder.dailyTime;
  const repeatDescription = formatRepeatDescription(reminder, now, workdayReminder);
  return [formatDateKey(getReminderDueDateKey(reminder, now)), time, repeatDescription].filter(Boolean).join(' ');
}

function isReminderPastDue(reminder: Reminder, now: Date) {
  if (reminder.completed) {
    return false;
  }

  const deadline = getReminderDeadline(reminder, now);
  return Boolean(deadline && deadline.getTime() < now.getTime());
}

function getReminderDeadline(reminder: Reminder, now: Date) {
  if (reminder.repeatRule !== 'once') {
    return getTodayReminderDate(reminder, now);
  }

  const [hour = 0, minute = 0] = (reminder.todayOverrideTime || reminder.dailyTime).split(':').map(Number);
  const [year = '0', month = '1', day = '1'] = reminder.scheduledDate.split('-');
  const deadline = new Date(Number(year), Number(month) - 1, Number(day), hour, minute, 0, 0);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

function compareRemindersForMenu(first: Reminder, second: Reminder, now: Date) {
  if (Boolean(first.completed) !== Boolean(second.completed)) {
    return first.completed ? 1 : -1;
  }

  if (!first.completed && !second.completed) {
    return compareNumbers(getReminderDueSortTime(first, now), getReminderDueSortTime(second, now), getReminderCreatedSortTime(first), getReminderCreatedSortTime(second));
  }

  return compareNumbers(getCompletedSortTime(second), getCompletedSortTime(first), getReminderCreatedSortTime(first), getReminderCreatedSortTime(second));
}

function compareNumbers(first: number, second: number, firstCreatedTime: number, secondCreatedTime: number) {
  if (first !== second) {
    return first - second;
  }
  return secondCreatedTime - firstCreatedTime;
}

function getReminderDueSortTime(reminder: Reminder, now: Date) {
  const dueDateKey = getReminderDueDateKey(reminder, now);
  if (!dueDateKey) {
    return Number.POSITIVE_INFINITY;
  }

  const [hour = 0, minute = 0] = (reminder.todayOverrideTime || reminder.dailyTime).split(':').map(Number);
  const dueDate = new Date(`${dueDateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
  const dueTime = dueDate.getTime();
  return Number.isNaN(dueTime) ? Number.POSITIVE_INFINITY : dueTime;
}

function getCompletedSortTime(reminder: Reminder) {
  const completedTime = new Date(reminder.completedAt || '').getTime();
  return Number.isNaN(completedTime) ? 0 : completedTime;
}

function getReminderCreatedSortTime(reminder: Reminder) {
  const createdTime = new Date(reminder.createdAt || '').getTime();
  if (!Number.isNaN(createdTime)) {
    return createdTime;
  }

  const [, timestamp] = reminder.id.match(/^[^_]+_(\d+)_/) || [];
  const idTime = Number(timestamp);
  return Number.isFinite(idTime) ? idTime : 0;
}

function formatWeeklyDays(reminder: Reminder) {
  if (reminder.repeatRule === 'daily') {
    return '每天';
  }
  if (reminder.repeatRule === 'weekdays') {
    return '周一至周五';
  }
  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return '大小周';
  }

  const days = reminder.weeklyDays || [];
  if (days.length === 1) {
    return `每周${WEEK_DAYS.find((day) => day.value === days[0])?.label || ''}`;
  }
  if (days.join(',') === '1,2,3,4,5,6') {
    return '周一至周六';
  }
  if (days.join(',') === '0,1,2,3,4,5,6') {
    return '每天';
  }
  return days.map((dayValue) => WEEK_DAYS.find((day) => day.value === dayValue)?.label).filter(Boolean).join('、');
}

function formatRepeatDescription(reminder: Reminder, now: Date, workdayReminder?: Reminder) {
  if (reminder.repeatRule === 'once') {
    return '';
  }
  if (reminder.repeatRule === 'daily') {
    return '每天重复';
  }

  const days = getReminderRepeatDays(reminder, now);
  if (days.length === 0) {
    return '';
  }

  const workdayDays = getWorkdayRepeatDays(workdayReminder, now);
  if (workdayDays.length > 0 && areSameWeekDays(days, workdayDays)) {
    return '工作日重复';
  }

  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return `${formatCurrentWeekRepeatDays(days)}重复`;
  }

  return `${formatWeeklyRepeatDays(days)}重复`;
}

function getWorkdayRepeatDefaults(workdayReminder: Reminder | undefined, fallbackDays = DEFAULT_WORK_WEEK_DAYS) {
  const normalizedFallbackDays = orderWeekDays(fallbackDays);
  if (!workdayReminder || !workdayReminder.enabled) {
    return {
      weeklyDays: normalizedFallbackDays,
      alternateWeekAnchorDate: undefined,
      alternateWeekDays: normalizedFallbackDays,
      alternateNextWeekDays: normalizedFallbackDays
    };
  }

  if (workdayReminder.useAlternateWeeks || workdayReminder.repeatRule === 'alternate-weeks') {
    const alternateWeekDays = orderWeekDays(workdayReminder.alternateWeekDays?.length ? workdayReminder.alternateWeekDays : normalizedFallbackDays);
    const alternateNextWeekDays = orderWeekDays(workdayReminder.alternateNextWeekDays?.length ? workdayReminder.alternateNextWeekDays : normalizedFallbackDays);
    return {
      weeklyDays: orderWeekDays(getAlternateWeekDays(workdayReminder, new Date())),
      alternateWeekAnchorDate: workdayReminder.alternateWeekAnchorDate,
      alternateWeekDays,
      alternateNextWeekDays
    };
  }

  if (workdayReminder.repeatRule === 'weekdays' || workdayReminder.repeatRule === 'weekly') {
    const weeklyDays = orderWeekDays(workdayReminder.weeklyDays?.length ? workdayReminder.weeklyDays : normalizedFallbackDays);
    return {
      weeklyDays,
      alternateWeekAnchorDate: undefined,
      alternateWeekDays: weeklyDays,
      alternateNextWeekDays: weeklyDays
    };
  }

  return {
    weeklyDays: normalizedFallbackDays,
    alternateWeekAnchorDate: undefined,
    alternateWeekDays: normalizedFallbackDays,
    alternateNextWeekDays: normalizedFallbackDays
  };
}

function getReminderRepeatDays(reminder: Reminder, now: Date) {
  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return orderWeekDays(getAlternateWeekDays(reminder, now));
  }
  if (reminder.repeatRule === 'weekdays') {
    return orderWeekDays(reminder.weeklyDays?.length ? reminder.weeklyDays : DEFAULT_WORK_WEEK_DAYS);
  }
  if (reminder.repeatRule === 'weekly') {
    return orderWeekDays(reminder.weeklyDays || []);
  }
  return [];
}

function getWorkdayRepeatDays(reminder: Reminder | undefined, now: Date) {
  if (!reminder || !reminder.enabled) {
    return [];
  }
  if (reminder.useAlternateWeeks || reminder.repeatRule === 'alternate-weeks') {
    return orderWeekDays(getAlternateWeekDays(reminder, now));
  }
  if (reminder.repeatRule === 'weekdays' || reminder.repeatRule === 'weekly') {
    return orderWeekDays(reminder.weeklyDays?.length ? reminder.weeklyDays : DEFAULT_WORK_WEEK_DAYS);
  }
  return [];
}

function formatWeeklyRepeatDays(days: number[]) {
  const orderedDays = orderWeekDays(days);
  if (orderedDays.length === 1) {
    return `每${formatWeekdayName(orderedDays[0])}`;
  }
  if (isContinuousWeekRange(orderedDays)) {
    return `每${formatWeekdayName(orderedDays[0])}～${formatWeekdayLabel(orderedDays[orderedDays.length - 1])}`;
  }
  return `每${orderedDays.map((day, index) => (index === 0 ? formatWeekdayName(day) : formatWeekdayLabel(day))).join('、')}`;
}

function formatCurrentWeekRepeatDays(days: number[]) {
  const orderedDays = orderWeekDays(days);
  if (orderedDays.length === 1) {
    return `本${formatWeekdayName(orderedDays[0])}`;
  }
  if (isContinuousWeekRange(orderedDays)) {
    return `本${formatWeekdayName(orderedDays[0])}～${formatWeekdayLabel(orderedDays[orderedDays.length - 1])}`;
  }
  return `本${orderedDays.map((day, index) => (index === 0 ? formatWeekdayName(day) : formatWeekdayLabel(day))).join('、')}`;
}

function orderWeekDays(days: number[]) {
  const uniqueDays = Array.from(new Set(days.filter((day) => WEEK_DAYS.some((item) => item.value === day))));
  return WEEK_DAYS.map((day) => day.value).filter((day) => uniqueDays.includes(day));
}

function isContinuousWeekRange(days: number[]) {
  if (days.length < 2) {
    return false;
  }
  const indexes = days.map((day) => WEEK_DAYS.findIndex((item) => item.value === day));
  return indexes.every((index, itemIndex) => itemIndex === 0 || index === indexes[itemIndex - 1] + 1);
}

function areSameWeekDays(first: number[], second: number[]) {
  const orderedFirst = orderWeekDays(first);
  const orderedSecond = orderWeekDays(second);
  return orderedFirst.length === orderedSecond.length && orderedFirst.every((day, index) => day === orderedSecond[index]);
}

function formatWeekdayName(dayValue: number) {
  const label = formatWeekdayLabel(dayValue);
  return label ? `周${label}` : '';
}

function formatWeekdayLabel(dayValue: number) {
  const label = WEEK_DAYS.find((day) => day.value === dayValue)?.label;
  return label || '';
}

type OffWorkCountdownState = {
  text: string;
  showTimeMeta: boolean;
};

function formatTodayOffWorkTime(reminder: Reminder, now: Date) {
  return `今天 ${getTodayOffWorkTime(reminder, now)} 下班`;
}

function formatReminderNotifyTime(reminder: Reminder, now: Date) {
  if (reminder.advanceMinutes <= 0) {
    return '';
  }

  return `将在 ${shiftTimeByMinutes(getTodayOffWorkTime(reminder, now), -reminder.advanceMinutes)} 提醒你`;
}

function getTodayOffWorkTime(reminder: Reminder, now: Date) {
  const todayKey = toDateKey(now);
  return reminder.todayOverrideDate === todayKey && reminder.todayOverrideTime
    ? reminder.todayOverrideTime
    : reminder.dailyTime;
}

function shiftTimeByMinutes(time: string, offsetMinutes: number) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const totalMinutes = ((hour * 60 + minute + offsetMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function formatDateKey(dateKey?: string) {
  if (!dateKey) return '无截止日期';
  const [, month = '', day = ''] = dateKey.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function getOffWorkCountdownState(reminder: Reminder, now: Date): OffWorkCountdownState {
  if (!reminder.enabled) {
    return {
      text: '已暂停',
      showTimeMeta: true
    };
  }

  const target = getTodayReminderDate(reminder, now);
  if (!target) {
    return {
      text: '好好休息',
      showTimeMeta: false
    };
  }

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return {
      text: '好好休息',
      showTimeMeta: false
    };
  }

  const totalSeconds = Math.ceil(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    text: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    showTimeMeta: true
  };
}

function getTodayReminderDate(reminder: Reminder, now: Date) {
  if (!shouldDisplayOnDate(reminder, now, toDateKey(now))) {
    return null;
  }

  const [hour = 18, minute = 0] = getTodayOffWorkTime(reminder, now).split(':').map(Number);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return target;
}

function shouldDisplayOnDate(reminder: Reminder, date: Date, dateKey: string) {
  if (reminder.repeatRule === 'once') {
    return reminder.scheduledDate === dateKey;
  }
  return shouldReminderRunOnDate(reminder, date, dateKey);
}

function getTodayOverrideLabel(reminder: Reminder) {
  if (!reminder.todayOverrideTime) {
    return '今天早点走';
  }
  return timeToMinutes(reminder.todayOverrideTime) > timeToMinutes(reminder.dailyTime) ? '今天晚点走' : '今天早点走';
}

function timeToMinutes(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function createDueDatePatch(reminder: Reminder, scheduledDate: string): Partial<Reminder> {
  const patch: Partial<Reminder> = { scheduledDate };

  if (reminder.completed && scheduledDate > toDateKey(new Date())) {
    patch.completed = false;
    patch.completedAt = undefined;
  }

  return patch;
}

function toggleDay(days: number[] | undefined, day: number) {
  const currentDays = days || [];
  return currentDays.includes(day)
    ? currentDays.filter((item) => item !== day)
    : [...currentDays, day].sort();
}

function updateSelectedDisplayIds(currentDisplayIds: string[], displays: DisplayInfo[], displayId: string, checked: boolean) {
  let selectedDisplayIds = checked
    ? Array.from(new Set([...currentDisplayIds, displayId]))
    : currentDisplayIds.filter((id) => id !== displayId);
  const primaryDisplayId = displays.find((display) => display.isPrimary)?.id || displays[0]?.id;
  if (selectedDisplayIds.length === 0 && primaryDisplayId) {
    selectedDisplayIds = [primaryDisplayId];
  }
  return selectedDisplayIds;
}

function formatSelectedDisplays(selectedDisplayIds: string[], displays: DisplayInfo[]) {
  const selectedDisplays = displays.filter((display) => selectedDisplayIds.includes(display.id));
  if (selectedDisplays.length === 0) {
    return '默认主屏幕';
  }
  if (selectedDisplays.length === displays.length && displays.length > 1) {
    return '全部屏幕';
  }
  return `${selectedDisplays.length}个屏幕`;
}

function getSettingsAboutMenuWidth(aboutInfo: AppAboutInfo) {
  const rows = [
    '作者：李俊彦',
    '小红书：@李俊彦的导演笔记（小红书号：chasingup）',
    '邮箱：chase_li@qq.com',
    `Version ${aboutInfo.version}`,
    `Copyright © ${aboutInfo.currentYear} 佛山市戴胜文化传媒有限公司`
  ];
  const textWidth = measureMenuTextWidth(rows);
  return Math.ceil(clampNumber(
    textWidth + SETTINGS_ABOUT_MENU_HORIZONTAL_PADDING,
    SETTINGS_ABOUT_MENU_MIN_WIDTH,
    SETTINGS_ABOUT_MENU_MAX_WIDTH
  ));
}

function measureMenuTextWidth(values: string[]) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return SETTINGS_ABOUT_MENU_MIN_WIDTH;
  }

  // Electron 需要在创建浮层窗口前确定尺寸，所以这里按菜单字体预估“关于软件”的内容宽度。
  context.font = '12px Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  return values.reduce((maxWidth, value) => Math.max(maxWidth, context.measureText(value).width), 0);
}

function getExternalEmptyText(tab: ExternalPanelTab, accessList: ExternalSourceAccess[]) {
  const kind: ExternalAccessKind = tab === 'calendar' ? 'calendar' : 'reminders';
  const access = accessList.find((item) => item.kind === kind);
  const defaultText = tab === 'calendar' ? '未读取到日历日程' : '未读取到提醒事项';

  if (!access || access.granted) {
    return defaultText;
  }

  if (access.message) {
    return access.message;
  }

  return getExternalAccessInstruction(kind, access.status);
}

function getExternalLoadingText(tab: ExternalPanelTab) {
  return tab === 'calendar' ? '正在读取本机日历日程...' : '正在读取本机提醒事项...';
}

function isExternalEventLinked(event: ExternalEvent, reminders: Reminder[]) {
  const eventLinkKeys = new Set(getExternalEventLinkKeys(event));
  return reminders.some((reminder) => (
    reminder.linkedExternalSource
    && getExternalSourceLinkKeys(reminder.linkedExternalSource).some((key) => eventLinkKeys.has(key))
  ));
}

function formatExternalEventTitle(event: ExternalEvent) {
  const title = event.title.trim();
  if (title && title !== '提醒事项' && title !== '日历日程') {
    return title;
  }
  return event.provider === 'macos-reminders' ? '未命名提醒' : '未命名日程';
}

function formatExternalEventMeta(event: ExternalEvent, linked: boolean) {
  const dateTime = formatDateTime(event.startTime);
  return linked ? `${dateTime} · 已同步` : dateTime;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isExternalEventHistorical(event: ExternalEvent, now = new Date()) {
  if (event.provider !== 'macos-reminders') {
    return false;
  }
  const eventDate = new Date(event.startTime);
  if (Number.isNaN(eventDate.getTime())) {
    return false;
  }
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return eventDate.getTime() < todayStart.getTime();
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
