import electron, { type Tray } from 'electron/main';
import { join } from 'node:path';
import {
  MENU_PANEL_ANIMATION_MS,
  MENU_PANEL_SIZE
} from '../shared/window.js';
import { createAppIcon } from './icons.js';
import {
  getMenuPanelPosition,
  getWindowSizeWithSurfaceOutset,
  isCursorInsideWindow
} from './windowGeometry.js';
import type { StatusBarAnchorBounds } from './statusBarEntry.js';

const { app, BrowserWindow } = electron;
type BrowserWindow = Electron.BrowserWindow;

type MenuPanelControllerOptions = {
  dirname: string;
  isQuitting: () => boolean;
  getStatusBarAnchorBounds: () => StatusBarAnchorBounds | Tray | null;
  hasVisibleReminderOverlay: () => boolean;
  broadcastOverlayVisibility: () => void;
  closeFloatingWindows: () => void;
  getCursorInsideFloatingWindow: () => BrowserWindow | null;
  isCursorInsideFloatingWindowBridge: () => boolean;
  isManagedFloatingWindow: (windowItem: BrowserWindow) => boolean;
  showFloatingWindowAbovePanel: (windowItem: BrowserWindow) => void;
  loadRenderer: (windowItem: BrowserWindow, route?: string) => Promise<void>;
  requestBeforeHide: (windowItem: BrowserWindow) => Promise<boolean>;
  sendWindowMessage: (windowItem: BrowserWindow, channel: string, ...args: unknown[]) => boolean;
  onDidShow?: () => void;
};

const MENU_PANEL_BLUR_HIDE_DELAY_MS = 360;
const MENU_PANEL_INTERNAL_INTERACTION_GRACE_MS = 900;
const MENU_PANEL_WINDOW_SIZE = getWindowSizeWithSurfaceOutset(MENU_PANEL_SIZE);

export class MenuPanelController {
  private window: BrowserWindow | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private blurTimer: NodeJS.Timeout | null = null;
  private loadPromise: Promise<void> | null = null;
  private isRendererLoaded = false;
  private hideRequestInFlight = false;
  private keepOpenUntil = 0;
  private shouldOpenSettings = false;
  private shouldShowWhenLoaded = false;

  constructor(private readonly options: MenuPanelControllerOptions) {}

  getWindow() {
    return this.window;
  }

  toggle() {
    if (this.options.isQuitting()) {
      return;
    }

    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      void this.hideWithAnimation(this.window);
      return;
    }

    this.show();
  }

  prepare() {
    if (this.options.isQuitting()) {
      return Promise.resolve();
    }

    return this.ensureWindow();
  }

  show() {
    if (this.options.isQuitting()) {
      return;
    }

    const windowItem = this.ensureWindow();
    if (this.window && !this.window.isDestroyed() && this.isRendererLoaded) {
      this.showWindow(this.window);
      return;
    }

    this.shouldShowWhenLoaded = true;
    void windowItem;
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) {
      return this.loadPromise ?? Promise.resolve();
    }

    this.isRendererLoaded = false;
    this.shouldShowWhenLoaded = false;
    this.window = new BrowserWindow({
      width: MENU_PANEL_WINDOW_SIZE.width,
      height: MENU_PANEL_WINDOW_SIZE.height,
      minWidth: MENU_PANEL_WINDOW_SIZE.width,
      minHeight: MENU_PANEL_WINDOW_SIZE.height,
      maxWidth: MENU_PANEL_WINDOW_SIZE.width,
      maxHeight: MENU_PANEL_WINDOW_SIZE.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // 二级菜单拿到焦点后，第一次点回主面板也要交给渲染层处理，用来立即收起菜单。
      acceptFirstMouse: true,
      skipTaskbar: true,
      title: '下班啦',
      icon: createAppIcon(),
      backgroundColor: '#00000000',
      // 透明菜单栏面板由 CSS 绘制圆角和阴影，关闭原生窗口阴影避免出现双层外框。
      hasShadow: false,
      webPreferences: {
        preload: join(this.options.dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.on('blur', () => {
      // 菜单栏弹窗应像系统弹出面板一样，用户点到别处后自动收起。
      if (this.window && !this.window.isDestroyed()) {
        if (this.options.hasVisibleReminderOverlay()) {
          return;
        }
        this.scheduleBlurHide(this.window);
      }
    });
    const pendingWindow = this.window;
    this.loadPromise = this.options.loadRenderer(pendingWindow)
      .then(() => {
        // 菜单栏入口只在主面板完成首屏加载后创建，避免入口出现但首次点击仍无响应。
        if (
          pendingWindow === this.window
          && !pendingWindow.isDestroyed()
        ) {
          this.isRendererLoaded = true;
          if (this.shouldShowWhenLoaded) {
            this.showWindow(pendingWindow);
          }
        }
      })
      .catch((error: unknown) => {
        console.error('菜单面板加载失败', error);
      });
    this.window.on('closed', () => {
      this.clearBlurTimer();
      this.clearHideTimer();
      this.options.closeFloatingWindows();
      this.window = null;
      this.loadPromise = null;
      this.isRendererLoaded = false;
      this.shouldShowWhenLoaded = false;
    });

    return this.loadPromise;
  }

  showWithSettings() {
    this.shouldOpenSettings = true;
    this.show();
  }

  hideToBackground() {
    this.shouldOpenSettings = false;
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    void this.hideWithAnimation(this.window);
  }

  hideAfterAppDeactivation() {
    this.keepOpenUntil = 0;
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
      return;
    }

    if (this.options.hasVisibleReminderOverlay()) {
      return;
    }

    void this.hideWithAnimation(this.window);
  }

  keepOpenForInternalInteraction() {
    this.keepOpenUntil = Date.now() + MENU_PANEL_INTERNAL_INTERACTION_GRACE_MS;
    this.clearBlurTimer();
  }

  scheduleBlurHide(windowItem: BrowserWindow) {
    this.clearBlurTimer();
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (windowItem.isDestroyed() || !windowItem.isVisible()) {
        return;
      }
      const hoveredFloatingWindow = this.options.getCursorInsideFloatingWindow();
      const cursorInsidePanel = isCursorInsideWindow(windowItem);
      const cursorInsideMenuBridge = this.options.isCursorInsideFloatingWindowBridge();
      const cursorInsideMenuSurface = Boolean(hoveredFloatingWindow || cursorInsidePanel || cursorInsideMenuBridge);
      if (Date.now() <= this.keepOpenUntil && cursorInsideMenuSurface) {
        // macOS 会把跨 BrowserWindow 的菜单滑动/点击判成主面板失焦；只有鼠标仍在菜单组内时才消费这段宽限。
        if (hoveredFloatingWindow) {
          this.options.showFloatingWindowAbovePanel(hoveredFloatingWindow);
          return;
        }
        if (cursorInsidePanel) {
          windowItem.focus();
          return;
        }
        if (cursorInsideMenuBridge) {
          this.scheduleBlurHide(windowItem);
        }
        return;
      }
      const focusedWindow = BrowserWindow.getFocusedWindow();
      if (focusedWindow && this.isManagedWindow(focusedWindow)) {
        return;
      }
      if (hoveredFloatingWindow) {
        this.options.showFloatingWindowAbovePanel(hoveredFloatingWindow);
        return;
      }
      if (cursorInsidePanel) {
        windowItem.focus();
        return;
      }
      void this.hideWithAnimation(windowItem);
    }, MENU_PANEL_BLUR_HIDE_DELAY_MS);
  }

  isManagedWindow(windowItem: BrowserWindow | null | undefined) {
    if (!windowItem || windowItem.isDestroyed()) {
      return false;
    }
    if (this.window && windowItem === this.window) {
      return true;
    }

    return this.options.isManagedFloatingWindow(windowItem);
  }

  clearBlurTimer() {
    if (!this.blurTimer) {
      return;
    }

    clearTimeout(this.blurTimer);
    this.blurTimer = null;
  }

  clearHideTimer() {
    if (!this.hideTimer) {
      return;
    }

    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.hideRequestInFlight = false;
  }

  closeWindow() {
    if (!this.window || this.window.isDestroyed()) {
      this.window = null;
      return;
    }

    this.window.close();
  }

  cleanup() {
    this.clearBlurTimer();
    this.clearHideTimer();
    this.options.closeFloatingWindows();
    this.closeWindow();
  }

  private showWindow(windowItem: BrowserWindow) {
    this.clearHideTimer();
    windowItem.setPosition(...getMenuPanelPosition(windowItem, this.options.getStatusBarAnchorBounds()), false);
    windowItem.show();
    windowItem.moveTop();
    this.options.sendWindowMessage(windowItem, 'menu-panel:did-show');
    if (this.shouldOpenSettings) {
      this.shouldOpenSettings = false;
      this.options.sendWindowMessage(windowItem, 'menu-panel:open-settings');
    }
    this.options.broadcastOverlayVisibility();
    this.options.onDidShow?.();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
    windowItem.focus();
  }

  private async hideWithAnimation(windowItem: BrowserWindow) {
    if (this.hideTimer || this.hideRequestInFlight || windowItem.isDestroyed() || !windowItem.isVisible()) {
      return;
    }

    this.clearBlurTimer();
    this.hideRequestInFlight = true;
    const canHide = await this.options.requestBeforeHide(windowItem);
    this.hideRequestInFlight = false;
    if (!canHide || windowItem.isDestroyed() || !windowItem.isVisible()) {
      return;
    }

    this.options.sendWindowMessage(windowItem, 'menu-panel:will-hide');
    this.options.closeFloatingWindows();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!windowItem.isDestroyed()) {
        windowItem.hide();
      }
    }, MENU_PANEL_ANIMATION_MS);
  }
}
