import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MenuFloatingSurfaceKind, MenuFloatingSurfaceRequest } from '../../../shared/types';
import { getEventElement } from '../../utils/dom';

const FLOATING_SURFACE_KEEP_OPEN_THROTTLE_MS = 120;
const FLOATING_SUBMENU_KINDS: MenuFloatingSurfaceKind[] = [
  'settings-display',
  'settings-lock-screen',
  'settings-theme',
  'settings-about',
  'donation',
  'reminder-date',
  'reminder-repeat',
  'today-override',
  'default-messages'
];

let lastFloatingSubmenuCloseAt = 0;
let lastFloatingSurfaceKeepOpenAt = 0;

export function getElementAnchorRect(element: Element): MenuFloatingSurfaceRequest['anchorRect'] {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

export function getSyntheticAnchorRect(x: number, y: number): MenuFloatingSurfaceRequest['anchorRect'] {
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

export function useFloatingSubmenu() {
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

export function closeFloatingSubmenusFromParentPointer(
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

export function syncHoveredFloatingMenuRow(event: React.MouseEvent<HTMLElement>) {
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

export function clearHoveredFloatingMenuRow(event: React.MouseEvent<HTMLElement>) {
  event.currentTarget.querySelectorAll('.floating-menu-row-hovered').forEach((row) => {
    row.classList.remove('floating-menu-row-hovered');
  });
}

export function FloatingMenuSurface(props: React.PropsWithChildren<{
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
