import { BrowserWindow, screen, type Tray } from 'electron';
import type { MenuFloatingSurfaceRequest } from '../shared/types.js';
import { MENU_PANEL_SIZE, MENU_SURFACE_OUTSET } from '../shared/window.js';
import { MENU_FLOATING_HOVER_BRIDGE_PX } from './menuFloatingConfig.js';

export function isCursorInsideWindow(windowItem: BrowserWindow) {
  const cursorPoint = screen.getCursorScreenPoint();
  const bounds = windowItem.getBounds();
  return (
    cursorPoint.x >= bounds.x
    && cursorPoint.x <= bounds.x + bounds.width
    && cursorPoint.y >= bounds.y
    && cursorPoint.y <= bounds.y + bounds.height
  );
}

export function isCursorInsideMenuWindowBridge(parentWindow: BrowserWindow, childWindow: BrowserWindow) {
  const cursorPoint = screen.getCursorScreenPoint();
  const parentBounds = parentWindow.getBounds();
  const childBounds = childWindow.getBounds();
  const horizontalGap = Math.max(
    childBounds.x - (parentBounds.x + parentBounds.width),
    parentBounds.x - (childBounds.x + childBounds.width),
    0
  );
  const verticalGap = Math.max(
    childBounds.y - (parentBounds.y + parentBounds.height),
    parentBounds.y - (childBounds.y + childBounds.height),
    0
  );

  if (horizontalGap > MENU_FLOATING_HOVER_BRIDGE_PX || verticalGap > MENU_FLOATING_HOVER_BRIDGE_PX) {
    return false;
  }

  // 多级菜单是多个透明 BrowserWindow，鼠标穿过窗口之间的缝隙时要把这段路视为仍在同一组菜单内。
  const left = Math.min(parentBounds.x, childBounds.x) - MENU_FLOATING_HOVER_BRIDGE_PX;
  const right = Math.max(parentBounds.x + parentBounds.width, childBounds.x + childBounds.width) + MENU_FLOATING_HOVER_BRIDGE_PX;
  const top = Math.min(parentBounds.y, childBounds.y) - MENU_FLOATING_HOVER_BRIDGE_PX;
  const bottom = Math.max(parentBounds.y + parentBounds.height, childBounds.y + childBounds.height) + MENU_FLOATING_HOVER_BRIDGE_PX;
  return cursorPoint.x >= left && cursorPoint.x <= right && cursorPoint.y >= top && cursorPoint.y <= bottom;
}

export function getMenuFloatingSurfacePosition(
  ownerWindow: BrowserWindow,
  request: MenuFloatingSurfaceRequest,
  size: { width: number; height: number }
): [number, number] {
  const anchor = getMenuFloatingSurfaceAnchor(ownerWindow, request);
  const placement = request.placement || 'bottom-left';
  let x = anchor.x;
  let y = anchor.y + anchor.height + 8;

  if (placement === 'bottom-right') {
    x = anchor.x + anchor.width - size.width;
  }
  if (placement === 'right-top') {
    x = anchor.x + anchor.width + 8;
    y = anchor.y;
  }
  if (placement === 'left-top') {
    x = anchor.x - size.width - 8;
    y = anchor.y;
  }

  const display = screen.getDisplayNearestPoint({
    x: anchor.x + Math.round(anchor.width / 2),
    y: anchor.y + Math.round(anchor.height / 2)
  });
  const workArea = display.workArea;
  const windowSize = getWindowSizeWithSurfaceOutset(size);
  return [
    clamp(x - MENU_SURFACE_OUTSET, workArea.x, workArea.x + workArea.width - windowSize.width),
    clamp(y - MENU_SURFACE_OUTSET, workArea.y, workArea.y + workArea.height - windowSize.height)
  ];
}

export function getMenuFloatingSurfaceAnchor(ownerWindow: BrowserWindow, request: MenuFloatingSurfaceRequest) {
  const ownerBounds = ownerWindow.getBounds();
  return {
    x: Math.round(ownerBounds.x + request.anchorRect.x),
    y: Math.round(ownerBounds.y + request.anchorRect.y),
    width: Math.round(request.anchorRect.width),
    height: Math.round(request.anchorRect.height)
  };
}

export function getWindowSizeWithSurfaceOutset(size: { width: number; height: number }) {
  return {
    width: size.width + MENU_SURFACE_OUTSET * 2,
    height: size.height + MENU_SURFACE_OUTSET * 2
  };
}

export function getMenuFloatingSurfaceAnchorPoint(ownerWindow: BrowserWindow, request: MenuFloatingSurfaceRequest) {
  const anchor = getMenuFloatingSurfaceAnchor(ownerWindow, request);
  return {
    x: anchor.x + Math.round(anchor.width / 2),
    y: anchor.y + Math.round(anchor.height / 2)
  };
}

export function getMenuPanelPosition(windowItem: BrowserWindow, tray: Tray | null): [number, number] {
  const windowBounds = windowItem.getBounds();
  const trayBounds = tray?.getBounds();
  const cursorPoint = screen.getCursorScreenPoint();
  const anchorPoint = trayBounds
    ? {
        x: Math.round(trayBounds.x + trayBounds.width / 2),
        y: Math.round(trayBounds.y + trayBounds.height / 2)
      }
    : cursorPoint;
  const display = screen.getDisplayNearestPoint(anchorPoint);
  const workArea = display.workArea;
  const hasTopMenuBar = trayBounds ? trayBounds.y <= workArea.y + 40 : anchorPoint.y <= workArea.y + 40;
  const visualPanelX = anchorPoint.x - Math.round(MENU_PANEL_SIZE.width / 2);
  const visualPanelY = hasTopMenuBar
    ? workArea.y + 8
    : workArea.y + workArea.height - MENU_PANEL_SIZE.height - 8;
  const x = clamp(
    visualPanelX - MENU_SURFACE_OUTSET,
    workArea.x,
    workArea.x + workArea.width - windowBounds.width
  );
  const y = clamp(
    visualPanelY - MENU_SURFACE_OUTSET,
    workArea.y,
    workArea.y + workArea.height - windowBounds.height
  );

  return [x, y];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
