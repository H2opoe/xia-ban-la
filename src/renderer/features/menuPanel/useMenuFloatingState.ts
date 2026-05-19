import { useEffect, useRef, useState } from 'react';
import type {
  MenuFloatingSurfaceKind,
  MenuFloatingSurfaceRequest,
  Reminder
} from '../../../shared/types';
import { getElementAnchorRect } from '../floatingSurfaces/floatingSurfaceModel';

export type ReminderContextMenuState = {
  reminderId: string;
};

type UseMenuFloatingStateOptions = {
  getMissingTitleReminderForInteraction: () => Reminder | null;
  openTitleWarningMenu: (reminder: Reminder) => Promise<void>;
};

export function useMenuFloatingState(options: UseMenuFloatingStateOptions) {
  const [activeFloatingSurface, setActiveFloatingSurface] = useState<MenuFloatingSurfaceKind | null>(null);
  const [contextMenuState, setContextMenuState] = useState<ReminderContextMenuState | null>(null);
  const activeFloatingSurfaceRef = useRef<MenuFloatingSurfaceKind | null>(null);
  const contextMenuStateRef = useRef<ReminderContextMenuState | null>(null);

  useEffect(() => {
    activeFloatingSurfaceRef.current = activeFloatingSurface;
  }, [activeFloatingSurface]);

  useEffect(() => {
    contextMenuStateRef.current = contextMenuState;
  }, [contextMenuState]);

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

    const blockingReminder = options.getMissingTitleReminderForInteraction();
    const isEditingSameMissingTitleReminder = request.kind === 'reminder-context' && request.reminderId === blockingReminder?.id;
    if (request.kind !== 'title-warning' && blockingReminder && !isEditingSameMissingTitleReminder) {
      void options.openTitleWarningMenu(blockingReminder);
      return;
    }

    await openFloatingSurface(request);
  }

  function toggleFloatingSurfaceFromElement(
    kind: MenuFloatingSurfaceKind,
    element: Element,
    requestOptions: Omit<MenuFloatingSurfaceRequest, 'kind' | 'anchorRect'> = {}
  ) {
    return toggleFloatingSurface({
      kind,
      anchorRect: getElementAnchorRect(element),
      ...requestOptions
    });
  }

  return {
    activeFloatingSurface,
    activeFloatingSurfaceRef,
    clearFloatingSurfaceState,
    closeFloatingSurface,
    contextMenuStateRef,
    openFloatingSurface,
    setActiveFloatingSurface,
    toggleFloatingSurface,
    toggleFloatingSurfaceFromElement
  };
}
