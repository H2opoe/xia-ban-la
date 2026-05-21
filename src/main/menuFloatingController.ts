import electron from 'electron/main';
import { join } from 'node:path';
import type { MenuFloatingSurfaceKind, MenuFloatingSurfaceRequest } from '../shared/types.js';
import { MENU_SURFACE_OUTSET } from '../shared/window.js';
import { createAppIcon } from './icons.js';
import {
  MENU_FLOATING_NESTED_KINDS,
  MENU_FLOATING_POINTER_POLL_MS,
  MENU_FLOATING_SURFACE_SIZES,
  MENU_NESTED_HOVER_CLOSE_DELAY_MS
} from './menuFloatingConfig.js';
import {
  getMenuFloatingSurfacePosition,
  isCursorInsideMenuWindowBridge,
  isCursorInsideWindow
} from './windowGeometry.js';

const { app, BrowserWindow, screen } = electron;
type BrowserWindow = Electron.BrowserWindow;

type MenuFloatingControllerOptions = {
  dirname: string;
  isQuitting: () => boolean;
  getMenuPanelWindow: () => BrowserWindow | null;
  keepMenuPanelOpenForInternalInteraction: () => void;
  scheduleMenuPanelBlurHide: (windowItem: BrowserWindow) => void;
  clearMenuPanelHideTimer: () => void;
  loadRenderer: (windowItem: BrowserWindow, route?: string) => Promise<void>;
  sendWindowMessage: (windowItem: BrowserWindow, channel: string, ...args: unknown[]) => boolean;
};

export class MenuFloatingController {
  private readonly windows = new Map<MenuFloatingSurfaceKind, BrowserWindow>();
  private readonly requests = new Map<MenuFloatingSurfaceKind, MenuFloatingSurfaceRequest>();
  private readonly parentKinds = new Map<MenuFloatingSurfaceKind, MenuFloatingSurfaceKind | null>();
  private readonly nestedHoverOutSince = new Map<MenuFloatingSurfaceKind, number>();
  private pointerTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: MenuFloatingControllerOptions) {}

  async openSurface(sender: Electron.WebContents, request: MenuFloatingSurfaceRequest) {
    if (this.options.isQuitting()) {
      return;
    }

    this.options.keepMenuPanelOpenForInternalInteraction();
    const ownerWindow = BrowserWindow.fromWebContents(sender);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return;
    }
    const parentKind = this.getKindByWindow(ownerWindow);

    const size = this.getSurfaceSize(request);
    const [x, y] = getMenuFloatingSurfacePosition(ownerWindow, request, size);
    const route = this.getSurfaceRoute(request);
    const existingWindow = this.windows.get(request.kind);
    if (existingWindow && !existingWindow.isDestroyed() && existingWindow.webContents.getURL().includes(route)) {
      this.requests.set(request.kind, request);
      const currentBounds = existingWindow.getBounds();
      const [nextX, nextY] = getMenuFloatingSurfacePosition(ownerWindow, request, {
        width: currentBounds.width - MENU_SURFACE_OUTSET * 2,
        height: currentBounds.height - MENU_SURFACE_OUTSET * 2
      });
      if (currentBounds.x !== nextX || currentBounds.y !== nextY) {
        existingWindow.setBounds({ x: nextX, y: nextY, width: currentBounds.width, height: currentBounds.height });
      }
      this.showWindowAbovePanel(existingWindow);
      this.parentKinds.set(request.kind, parentKind);
      this.startPointerMonitor();
      return;
    }

    if (MENU_FLOATING_NESTED_KINDS.has(request.kind)) {
      this.closeNested();
    } else {
      this.closeWindows();
    }

    const floatingWindow = new BrowserWindow({
      width: size.width + MENU_SURFACE_OUTSET * 2,
      height: size.height + MENU_SURFACE_OUTSET * 2,
      x,
      y,
      show: false,
      parent: ownerWindow,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      acceptFirstMouse: true,
      skipTaskbar: true,
      title: '下班啦',
      icon: createAppIcon(),
      backgroundColor: '#00000000',
      hasShadow: false,
      webPreferences: {
        preload: join(this.options.dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    this.windows.set(request.kind, floatingWindow);
    this.requests.set(request.kind, request);
    this.parentKinds.set(request.kind, parentKind);
    this.nestedHoverOutSince.delete(request.kind);
    this.startPointerMonitor();

    floatingWindow.once('ready-to-show', () => {
      if (!floatingWindow.isDestroyed()) {
        this.showWindowAbovePanel(floatingWindow);
      }
    });
    floatingWindow.on('blur', () => {
      const menuPanelWindow = this.options.getMenuPanelWindow();
      if (menuPanelWindow && !menuPanelWindow.isDestroyed()) {
        this.options.scheduleMenuPanelBlurHide(menuPanelWindow);
      }
    });
    floatingWindow.on('closed', () => {
      const wasCurrentWindow = this.windows.get(request.kind) === floatingWindow;
      if (wasCurrentWindow) {
        this.windows.delete(request.kind);
        this.requests.delete(request.kind);
        this.parentKinds.delete(request.kind);
        this.nestedHoverOutSince.delete(request.kind);
      }
      this.stopPointerMonitorIfIdle();
      if (wasCurrentWindow) {
        this.broadcastClosed(request.kind);
      }
    });

    try {
      await this.options.loadRenderer(floatingWindow, this.getSurfaceRoute(request));
      if (!floatingWindow.isDestroyed() && !floatingWindow.isVisible()) {
        this.showWindowAbovePanel(floatingWindow);
      }
    } catch (error: unknown) {
      // 浮层菜单会随 hover 快速替换；旧窗口在 loadURL 未完成前被关闭时，Electron 也会抛 ERR_FAILED。
      // 这不是渲染器加载故障，避免把正常的菜单切换误报成“加载失败”。
      if (this.isExpectedLoadInterruption(request.kind, floatingWindow)) {
        return;
      }
      console.error('菜单浮层加载失败', error);
      if (!floatingWindow.isDestroyed()) {
        floatingWindow.close();
      }
    }
  }

  closeWindows(kind?: MenuFloatingSurfaceKind) {
    const targets = kind
      ? [[kind, this.windows.get(kind)] as const]
      : Array.from(this.windows.entries());

    for (const [targetKind, floatingWindow] of targets) {
      if (!floatingWindow) {
        continue;
      }
      this.windows.delete(targetKind);
      this.requests.delete(targetKind);
      this.parentKinds.delete(targetKind);
      this.nestedHoverOutSince.delete(targetKind);
      if (!floatingWindow.isDestroyed()) {
        floatingWindow.close();
      }
      this.broadcastClosed(targetKind);
    }
    this.stopPointerMonitorIfIdle();
  }

  isCursorInsideSurface(windowItem: BrowserWindow) {
    if (isCursorInsideWindow(windowItem)) {
      return true;
    }

    return Boolean(this.getCursorInsideWindow() || this.isCursorInsideWindowBridge());
  }

  isManagedWindow(windowItem: BrowserWindow | null | undefined) {
    if (!windowItem || windowItem.isDestroyed()) {
      return false;
    }

    for (const floatingWindow of this.windows.values()) {
      if (windowItem === floatingWindow) {
        return true;
      }
    }

    return false;
  }

  private closeNested() {
    for (const kind of MENU_FLOATING_NESTED_KINDS) {
      this.closeWindows(kind);
    }
  }

  getCursorInsideWindow() {
    for (const floatingWindow of this.windows.values()) {
      if (!floatingWindow.isDestroyed() && floatingWindow.isVisible() && isCursorInsideWindow(floatingWindow)) {
        return floatingWindow;
      }
    }

    return null;
  }

  isCursorInsideWindowBridge() {
    for (const [kind, floatingWindow] of this.windows.entries()) {
      if (floatingWindow.isDestroyed() || !floatingWindow.isVisible()) {
        continue;
      }
      const parentKind = this.parentKinds.get(kind) ?? null;
      const menuPanelWindow = this.options.getMenuPanelWindow();
      const parentWindow = parentKind ? this.windows.get(parentKind) : menuPanelWindow;
      if (
        parentWindow
        && !parentWindow.isDestroyed()
        && parentWindow.isVisible()
        && isCursorInsideMenuWindowBridge(parentWindow, floatingWindow)
      ) {
        return true;
      }
    }

    return false;
  }

  private getKindByWindow(windowItem: BrowserWindow) {
    for (const [kind, floatingWindow] of this.windows.entries()) {
      if (floatingWindow === windowItem) {
        return kind;
      }
    }

    return null;
  }

  private startPointerMonitor() {
    if (this.pointerTimer) {
      return;
    }

    this.pointerTimer = setInterval(() => this.syncWindowsByPointer(), MENU_FLOATING_POINTER_POLL_MS);
  }

  private stopPointerMonitorIfIdle() {
    if (!this.pointerTimer || this.windows.size > 0) {
      return;
    }

    clearInterval(this.pointerTimer);
    this.pointerTimer = null;
    this.nestedHoverOutSince.clear();
  }

  private syncWindowsByPointer() {
    if (this.windows.size === 0) {
      this.stopPointerMonitorIfIdle();
      return;
    }

    const now = Date.now();
    for (const [kind, floatingWindow] of Array.from(this.windows.entries())) {
      if (floatingWindow.isDestroyed() || !floatingWindow.isVisible()) {
        this.nestedHoverOutSince.delete(kind);
        continue;
      }

      const pointerInsideChild = isCursorInsideWindow(floatingWindow);
      if (pointerInsideChild) {
        this.focusWindowForPointer(floatingWindow);
        this.refreshWindowPointerState(floatingWindow);
      }

      if (!MENU_FLOATING_NESTED_KINDS.has(kind)) {
        this.nestedHoverOutSince.delete(kind);
        continue;
      }

      const parentKind = this.parentKinds.get(kind) ?? null;
      const menuPanelWindow = this.options.getMenuPanelWindow();
      const parentWindow = parentKind ? this.windows.get(parentKind) : menuPanelWindow;
      const pointerInsideParent = Boolean(
        parentWindow
        && !parentWindow.isDestroyed()
        && parentWindow.isVisible()
        && isCursorInsideWindow(parentWindow)
      );
      const pointerInsideWindowBridge = Boolean(
        parentWindow
        && !parentWindow.isDestroyed()
        && parentWindow.isVisible()
        && isCursorInsideMenuWindowBridge(parentWindow, floatingWindow)
      );

      // 三级菜单跨 BrowserWindow 展示，mouseleave 不会天然跨窗口冒泡；这里用窗口边界统一收口。
      if (pointerInsideChild || pointerInsideParent || pointerInsideWindowBridge) {
        this.nestedHoverOutSince.delete(kind);
        continue;
      }

      const hoverOutStartedAt = this.nestedHoverOutSince.get(kind) || now;
      this.nestedHoverOutSince.set(kind, hoverOutStartedAt);
      if (now - hoverOutStartedAt >= MENU_NESTED_HOVER_CLOSE_DELAY_MS) {
        this.closeWindows(kind);
      }
    }
  }

  private isExpectedLoadInterruption(kind: MenuFloatingSurfaceKind, floatingWindow: BrowserWindow) {
    const activeWindow = this.windows.get(kind);
    return floatingWindow.isDestroyed() || activeWindow !== floatingWindow;
  }

  showWindowAbovePanel(floatingWindow: BrowserWindow) {
    floatingWindow.setAlwaysOnTop(true, 'pop-up-menu');
    if (process.platform === 'darwin') {
      floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    // 菜单浮层依附主面板展示，不主动抢焦点；否则 macOS 会在主面板和浮层之间反复 blur/focus，表现成明显闪动。
    if (!floatingWindow.isVisible()) {
      floatingWindow.showInactive();
    }
    floatingWindow.moveTop();
    this.refreshWindowPointerState(floatingWindow);
    setTimeout(() => this.refreshWindowPointerState(floatingWindow), MENU_FLOATING_POINTER_POLL_MS);
  }

  private refreshWindowPointerState(floatingWindow: BrowserWindow) {
    if (floatingWindow.isDestroyed() || !floatingWindow.isVisible() || floatingWindow.webContents.isDestroyed()) {
      return;
    }

    const bounds = floatingWindow.getBounds();
    const cursor = screen.getCursorScreenPoint();
    if (
      cursor.x < bounds.x
      || cursor.y < bounds.y
      || cursor.x >= bounds.x + bounds.width
      || cursor.y >= bounds.y + bounds.height
    ) {
      return;
    }

    // 浮层用 showInactive 展示以避免焦点闪动；主动补发一次 mouseMove，让刚出现的窗口立刻刷新 hover 高亮。
    floatingWindow.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.max(0, Math.min(bounds.width - 1, cursor.x - bounds.x)),
      y: Math.max(0, Math.min(bounds.height - 1, cursor.y - bounds.y)),
      movementX: 0,
      movementY: 0
    });
  }

  private focusWindowForPointer(floatingWindow: BrowserWindow) {
    if (floatingWindow.isDestroyed() || !floatingWindow.isVisible() || floatingWindow.isFocused()) {
      return;
    }

    // 鼠标进入独立 BrowserWindow 承载的二/三级菜单时，需要把焦点交给该窗口；
    // 否则 macOS 不会刷新真实 cursor 状态，链接 hover 也不会显示手指。
    this.options.keepMenuPanelOpenForInternalInteraction();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
    floatingWindow.focus();
    this.refreshWindowPointerState(floatingWindow);
  }

  private getSurfaceRoute(request: MenuFloatingSurfaceRequest) {
    const params = new URLSearchParams();
    if (request.reminderId) {
      params.set('reminderId', request.reminderId);
    }
    if (request.restoreTitle !== undefined) {
      params.set('restoreTitle', request.restoreTitle);
    }
    const query = params.toString();
    return `floating/${request.kind}${query ? `?${query}` : ''}`;
  }

  private getSurfaceSize(request: MenuFloatingSurfaceRequest) {
    const fallback = MENU_FLOATING_SURFACE_SIZES[request.kind];
    return {
      width: request.preferredWidth || fallback.width,
      height: request.preferredHeight || fallback.height
    };
  }

  private broadcastClosed(kind: MenuFloatingSurfaceKind) {
    for (const windowItem of BrowserWindow.getAllWindows()) {
      this.options.sendWindowMessage(windowItem, 'menu-floating:closed', kind);
    }
  }
}
