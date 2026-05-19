import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, screen, shell, Tray } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DisplayInfo,
  MenuFloatingSurfaceKind,
  MenuFloatingSurfaceRequest,
  Reminder,
  ReminderPayload,
  SyncResult
} from '../shared/types.js';
import {
  MENU_PANEL_ANIMATION_MS,
  MENU_PANEL_SIZE,
  MENU_SURFACE_OUTSET
} from '../shared/window.js';
import { createReminderPayload } from '../shared/reminderPayload.js';
import { createExternalReminderPatch } from '../shared/externalReminder.js';
import { getDisplayInfos } from './displays.js';
import { listExternalEvents, syncExternalSources } from './externalSources.js';
import { ReminderScheduler } from './scheduler.js';
import { ReminderStore } from './store.js';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
const store = new ReminderStore();

let tray: Tray | null = null;
let menuPanelWindow: BrowserWindow | null = null;
const menuFloatingWindows = new Map<MenuFloatingSurfaceKind, BrowserWindow>();
const menuFloatingRequests = new Map<MenuFloatingSurfaceKind, MenuFloatingSurfaceRequest>();
const menuFloatingParentKinds = new Map<MenuFloatingSurfaceKind, MenuFloatingSurfaceKind | null>();
let scheduler: ReminderScheduler;
let menuPanelHideTimer: NodeJS.Timeout | null = null;
let menuPanelBlurTimer: NodeJS.Timeout | null = null;
let menuFloatingPointerTimer: NodeJS.Timeout | null = null;
const nestedMenuHoverOutSince = new Map<MenuFloatingSurfaceKind, number>();
let menuPanelKeepOpenUntil = 0;
let menuPanelShouldOpenSettings = false;
let statusBarHelper: ChildProcess | null = null;
const reminderWindows = new Map<string, BrowserWindow[]>();
const reminderPayloads = new Map<number, ReminderPayload>();
const activeReminderSessions = new Map<string, ActiveReminderSession>();
const reminderRepeatTimers = new Map<string, NodeJS.Timeout>();
const displaySleepTimers = new Map<string, NodeJS.Timeout>();
let reminderWindowReassertTimer: NodeJS.Timeout | null = null;
const previewReminderSourceIds = new Map<string, string>();
const draftReminders = new Map<string, Reminder>();
let isQuittingApp = false;
const REMINDER_PREVIEW_TEXT = '这是提醒预览';
const MENU_PANEL_BLUR_HIDE_DELAY_MS = 360;
const MENU_PANEL_INTERNAL_INTERACTION_GRACE_MS = 900;
const MENU_FLOATING_POINTER_POLL_MS = 80;
const MENU_NESTED_HOVER_CLOSE_DELAY_MS = 180;
const MENU_FLOATING_HOVER_BRIDGE_PX = 18;
const STATUS_BAR_HELPER_NAME = 'status-bar-helper';
const REMINDER_ESCAPE_SHORTCUT = 'Escape';
const REMINDER_WINDOW_REASSERT_INTERVAL_MS = 3_000;
const REMINDER_WINDOW_TOP_LEVEL = 'floating';
const SETTINGS_TERTIARY_MENU_WIDTH = 210;
const SETTINGS_THEME_MENU_WIDTH = 105;
const MENU_FLOATING_SURFACE_SIZES: Record<MenuFloatingSurfaceKind, { width: number; height: number }> = {
  settings: { width: 160, height: 232 },
  'settings-display': { width: SETTINGS_TERTIARY_MENU_WIDTH, height: 220 },
  'settings-lock-screen': { width: SETTINGS_TERTIARY_MENU_WIDTH, height: 122 },
  'settings-theme': { width: SETTINGS_THEME_MENU_WIDTH, height: 116 },
  'settings-about': { width: 520, height: 184 },
  'external-sync': { width: 292, height: 260 },
  'reminder-context': { width: 178, height: 260 },
  'title-warning': { width: 190, height: 116 },
  'reminder-date': { width: 218, height: 300 },
  'reminder-repeat': { width: 204, height: 176 },
  'today-override': { width: 176, height: 148 },
  'default-messages': { width: 238, height: 280 }
};
const MENU_FLOATING_NESTED_KINDS = new Set<MenuFloatingSurfaceKind>([
  'settings-display',
  'settings-lock-screen',
  'settings-theme',
  'settings-about',
  'reminder-date',
  'reminder-repeat',
  'today-override',
  'default-messages'
]);
const MENU_PANEL_WINDOW_SIZE = getWindowSizeWithSurfaceOutset(MENU_PANEL_SIZE);
// 蓝底白图是默认安装图标和浅色主题应用图标；托盘/菜单栏只使用白色透明 SVG。
const LIGHT_APP_ICON_FILE = 'icon.png';
const DARK_APP_ICON_FILE = 'icon-dark.png';
const TRAY_ICON_FILE = 'tray.svg';
const WEEK_DAYS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 }
] as const;
const DEFAULT_WORK_WEEK_DAYS = [1, 2, 3, 4, 5];
type ReminderWindowOptions = {
  source?: 'schedule' | 'manual';
  displays?: DisplayInfo[];
  payload?: ReminderPayload;
  lockScreenAfterIdle?: boolean;
};
type ActiveReminderSession = {
  reminder: Reminder;
  displays: DisplayInfo[];
  payload: ReminderPayload;
};
const ALLOWED_EXTERNAL_LINKS = new Set([
  'https://www.xiaohongshu.com/user/profile/5bed9e4201e65d00013a32bf',
  'mailto:chase_li@qq.com'
]);
let reminderEscapeShortcutRegistered = false;

app.setName('下班啦');
if (process.platform === 'darwin') {
  app.dock?.hide();
}

void app.whenReady().then(async () => {
  await store.init();
  scheduler = new ReminderScheduler(store, showReminderWindows, hasOpenReminderWindow);
  registerIpc();
  registerStatusBarEntry();
  registerApplicationMenu();
  registerThemeIconUpdates();
  registerPowerRecoveryHandlers();
  applyRuntimeIcons();
  scheduler.start();

  screen.on('display-added', () => broadcastReminders());
  screen.on('display-removed', () => broadcastReminders());
  screen.on('display-metrics-changed', () => broadcastReminders());
});

app.on('window-all-closed', () => {
  // 托盘应用需要在设置窗口关闭后继续保留调度器和菜单栏入口。
});

app.on('browser-window-blur', (_event, windowItem) => {
  if (!isMenuManagedWindow(windowItem) || !menuPanelWindow || menuPanelWindow.isDestroyed()) {
    return;
  }

  if (hasVisibleReminderWindow()) {
    return;
  }

  scheduleMenuPanelBlurHide(menuPanelWindow);
});

if (process.platform === 'darwin') {
  app.on('did-resign-active', () => {
    hideMenuPanelAfterAppDeactivation();
  });
}

app.on('before-quit', () => {
  isQuittingApp = true;
  cleanupBeforeQuit();
});

if (process.platform === 'darwin') {
  process.on('SIGUSR1', () => {
    // 原生菜单栏 helper 只负责转发点击事件，开关状态统一由主进程判断。
    toggleMenuPanel();
  });
  process.on('SIGUSR2', () => {
    showMenuPanelWithSettings();
  });
}

function registerStatusBarEntry() {
  if (process.platform === 'darwin' && startStatusBarHelper()) {
    return;
  }

  createTray();
}

function registerPowerRecoveryHandlers() {
  const recoverReminderOverlays = () => {
    reassertActiveReminderWindows();
  };

  powerMonitor.on('resume', recoverReminderOverlays);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    powerMonitor.on('unlock-screen', recoverReminderOverlays);
  }
  if (process.platform === 'darwin') {
    powerMonitor.on('user-did-become-active', recoverReminderOverlays);
  }
}

function startStatusBarHelper() {
  const helperPath = getNativeHelperPath(STATUS_BAR_HELPER_NAME);
  if (!existsSync(helperPath)) {
    return false;
  }

  statusBarHelper = spawn(helperPath, [
    '--pid',
    String(process.pid),
    '--icon',
    getRuntimeBuildIconPath(TRAY_ICON_FILE)
  ], {
    stdio: 'ignore'
  });
  statusBarHelper.once('exit', () => {
    statusBarHelper = null;
  });
  statusBarHelper.once('error', () => {
    statusBarHelper = null;
    if (!isQuittingApp && !tray) {
      createTray();
    }
  });
  return true;
}

function stopStatusBarHelper() {
  if (!statusBarHelper || statusBarHelper.killed) {
    return;
  }

  statusBarHelper.kill();
  statusBarHelper = null;
}

function requestAppQuit() {
  isQuittingApp = true;
  cleanupBeforeQuit();
  app.quit();
}

function cleanupBeforeQuit() {
  clearMenuPanelBlurTimer();
  clearMenuPanelHideTimer();
  closeMenuFloatingWindows();
  closeMenuPanelWindow();
  closeAllReminderWindowsForQuit();
  destroyTray();
  globalShortcut.unregisterAll();
  reminderEscapeShortcutRegistered = false;
  stopStatusBarHelper();
  scheduler?.stop();
}

function closeMenuPanelWindow() {
  if (!menuPanelWindow || menuPanelWindow.isDestroyed()) {
    menuPanelWindow = null;
    return;
  }

  menuPanelWindow.close();
}

function destroyTray() {
  if (!tray) {
    return;
  }

  tray.removeAllListeners();
  tray.destroy();
  tray = null;
}

function getNativeHelperPath(helperName: string) {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'native', helperName);
  }

  return join(__dirname, '..', 'native', helperName);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('下班啦');
  if (process.platform === 'darwin') {
    // 菜单栏空间有限，入口使用固定 18px 模板图标；中文名称保留在 tooltip，避免长标题被系统挤出状态栏。
    tray.setTitle('');
    app.dock?.hide();
  }
  tray.on('click', toggleMenuPanel);
  tray.on('right-click', showMenuPanelWithSettings);
}

function registerThemeIconUpdates() {
  nativeTheme.on('updated', applyRuntimeIcons);
}

function applyRuntimeIcons() {
  const icon = createAppIcon();
  if (!icon.isEmpty()) {
    for (const windowItem of BrowserWindow.getAllWindows()) {
      windowItem.setIcon(icon);
    }
    if (process.platform === 'darwin') {
      app.dock?.setIcon(icon);
    }
  }

  if (tray) {
    tray.setImage(createTrayIcon());
  }
}

function updateReminderEscapeShortcut() {
  const shouldRegister = reminderWindows.size > 0;
  if (shouldRegister && !reminderEscapeShortcutRegistered) {
    reminderEscapeShortcutRegistered = globalShortcut.register(REMINDER_ESCAPE_SHORTCUT, () => {
      void dismissOpenRemindersFromShortcut();
    });
    if (!reminderEscapeShortcutRegistered) {
      console.warn('注册提醒 Esc 快捷键失败');
    }
    return;
  }

  if (!shouldRegister && reminderEscapeShortcutRegistered) {
    globalShortcut.unregister(REMINDER_ESCAPE_SHORTCUT);
    reminderEscapeShortcutRegistered = false;
  }
}

function registerApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '下班啦',
      submenu: [
        {
          label: '打开下班啦',
          click: showMenuPanel
        },
        { type: 'separator' },
        {
          label: '退出下班啦',
          role: 'quit'
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function toggleMenuPanel() {
  if (isQuittingApp) {
    return;
  }

  if (menuPanelWindow && !menuPanelWindow.isDestroyed() && menuPanelWindow.isVisible()) {
    hideMenuPanelWithAnimation(menuPanelWindow);
    return;
  }

  showMenuPanel();
}

function showMenuPanel() {
  if (isQuittingApp) {
    return;
  }

  if (menuPanelWindow && !menuPanelWindow.isDestroyed()) {
    showMenuPanelWindow(menuPanelWindow);
    return;
  }

  menuPanelWindow = new BrowserWindow({
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
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  menuPanelWindow.once('ready-to-show', () => {
    if (menuPanelWindow && !menuPanelWindow.isDestroyed()) {
      showMenuPanelWindow(menuPanelWindow);
    }
  });

  menuPanelWindow.on('blur', () => {
    // 菜单栏弹窗应像系统弹出面板一样，用户点到别处后自动收起。
    if (menuPanelWindow && !menuPanelWindow.isDestroyed()) {
      if (hasVisibleReminderWindow()) {
        return;
      }
      scheduleMenuPanelBlurHide(menuPanelWindow);
    }
  });
  const pendingMenuPanelWindow = menuPanelWindow;
  void loadRenderer(pendingMenuPanelWindow)
    .then(() => {
      // 透明无边框窗口在预览态偶尔不会触发 ready-to-show，需要在内容加载完成后再兜底显示。
      if (
        pendingMenuPanelWindow === menuPanelWindow
        && !pendingMenuPanelWindow.isDestroyed()
        && !pendingMenuPanelWindow.isVisible()
      ) {
        showMenuPanelWindow(pendingMenuPanelWindow);
      }
    })
    .catch((error: unknown) => {
      console.error('菜单面板加载失败', error);
    });
  menuPanelWindow.on('closed', () => {
    clearMenuPanelBlurTimer();
    clearMenuPanelHideTimer();
    closeMenuFloatingWindows();
    menuPanelWindow = null;
  });
}

function showMenuPanelWithSettings() {
  menuPanelShouldOpenSettings = true;
  showMenuPanel();
}

function showMenuPanelWindow(windowItem: BrowserWindow) {
  clearMenuPanelHideTimer();
  windowItem.setPosition(...getMenuPanelPosition(windowItem), false);
  windowItem.show();
  windowItem.moveTop();
  sendWindowMessage(windowItem, 'menu-panel:did-show');
  if (menuPanelShouldOpenSettings) {
    menuPanelShouldOpenSettings = false;
    sendWindowMessage(windowItem, 'menu-panel:open-settings');
  }
  broadcastReminderOverlayVisibility();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  windowItem.focus();
}

function hideMenuPanelWithAnimation(windowItem: BrowserWindow) {
  if (menuPanelHideTimer || windowItem.isDestroyed() || !windowItem.isVisible()) {
    return;
  }

  clearMenuPanelBlurTimer();
  sendWindowMessage(windowItem, 'menu-panel:will-hide');
  closeMenuFloatingWindows();
  menuPanelHideTimer = setTimeout(() => {
    menuPanelHideTimer = null;
    if (!windowItem.isDestroyed()) {
      windowItem.hide();
    }
  }, MENU_PANEL_ANIMATION_MS);
}

function hideAppToBackground() {
  menuPanelShouldOpenSettings = false;
  if (!menuPanelWindow || menuPanelWindow.isDestroyed()) {
    return;
  }

  hideMenuPanelWithAnimation(menuPanelWindow);
}

function hideMenuPanelAfterAppDeactivation() {
  menuPanelKeepOpenUntil = 0;
  if (!menuPanelWindow || menuPanelWindow.isDestroyed() || !menuPanelWindow.isVisible()) {
    return;
  }

  if (hasVisibleReminderWindow()) {
    return;
  }

  hideMenuPanelWithAnimation(menuPanelWindow);
}

function keepMenuPanelOpenForInternalInteraction() {
  menuPanelKeepOpenUntil = Date.now() + MENU_PANEL_INTERNAL_INTERACTION_GRACE_MS;
  clearMenuPanelBlurTimer();
}

function scheduleMenuPanelBlurHide(windowItem: BrowserWindow) {
  clearMenuPanelBlurTimer();
  menuPanelBlurTimer = setTimeout(() => {
    menuPanelBlurTimer = null;
    if (windowItem.isDestroyed() || !windowItem.isVisible()) {
      return;
    }
    const hoveredFloatingWindow = getCursorInsideMenuFloatingWindow();
    const cursorInsidePanel = isCursorInsideWindow(windowItem);
    const cursorInsideMenuBridge = isCursorInsideMenuFloatingWindowBridge();
    const cursorInsideMenuSurface = Boolean(hoveredFloatingWindow || cursorInsidePanel || cursorInsideMenuBridge);
    if (Date.now() <= menuPanelKeepOpenUntil && cursorInsideMenuSurface) {
      // macOS 会把跨 BrowserWindow 的菜单滑动/点击判成主面板失焦；只有鼠标仍在菜单组内时才消费这段宽限。
      if (hoveredFloatingWindow) {
        showMenuFloatingWindowAbovePanel(hoveredFloatingWindow);
        return;
      }
      if (cursorInsidePanel) {
        windowItem.focus();
        return;
      }
      if (cursorInsideMenuBridge) {
        scheduleMenuPanelBlurHide(windowItem);
      }
      return;
    }
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow && isMenuManagedWindow(focusedWindow)) {
      return;
    }
    if (hoveredFloatingWindow) {
      showMenuFloatingWindowAbovePanel(hoveredFloatingWindow);
      return;
    }
    if (cursorInsidePanel) {
      windowItem.focus();
      return;
    }
    hideMenuPanelWithAnimation(windowItem);
  }, MENU_PANEL_BLUR_HIDE_DELAY_MS);
}

function isCursorInsideWindow(windowItem: BrowserWindow) {
  const cursorPoint = screen.getCursorScreenPoint();
  const bounds = windowItem.getBounds();
  return (
    cursorPoint.x >= bounds.x
    && cursorPoint.x <= bounds.x + bounds.width
    && cursorPoint.y >= bounds.y
    && cursorPoint.y <= bounds.y + bounds.height
  );
}

function isCursorInsideMenuWindowBridge(parentWindow: BrowserWindow, childWindow: BrowserWindow) {
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

function isCursorInsideMenuSurface(windowItem: BrowserWindow) {
  if (isCursorInsideWindow(windowItem)) {
    return true;
  }

  return Boolean(getCursorInsideMenuFloatingWindow() || isCursorInsideMenuFloatingWindowBridge());
}

function getCursorInsideMenuFloatingWindow() {
  for (const floatingWindow of menuFloatingWindows.values()) {
    if (!floatingWindow.isDestroyed() && floatingWindow.isVisible() && isCursorInsideWindow(floatingWindow)) {
      return floatingWindow;
    }
  }

  return null;
}

function isCursorInsideMenuFloatingWindowBridge() {
  for (const [kind, floatingWindow] of menuFloatingWindows.entries()) {
    if (floatingWindow.isDestroyed() || !floatingWindow.isVisible()) {
      continue;
    }
    const parentKind = menuFloatingParentKinds.get(kind) ?? null;
    const parentWindow = parentKind ? menuFloatingWindows.get(parentKind) : menuPanelWindow;
    if (parentWindow && !parentWindow.isDestroyed() && parentWindow.isVisible() && isCursorInsideMenuWindowBridge(parentWindow, floatingWindow)) {
      return true;
    }
  }

  return false;
}

function isMenuManagedWindow(windowItem: BrowserWindow | null | undefined) {
  if (!windowItem || windowItem.isDestroyed()) {
    return false;
  }
  if (menuPanelWindow && windowItem === menuPanelWindow) {
    return true;
  }

  for (const floatingWindow of menuFloatingWindows.values()) {
    if (windowItem === floatingWindow) {
      return true;
    }
  }

  return false;
}

function clearMenuPanelBlurTimer() {
  if (!menuPanelBlurTimer) {
    return;
  }

  clearTimeout(menuPanelBlurTimer);
  menuPanelBlurTimer = null;
}

function clearMenuPanelHideTimer() {
  if (!menuPanelHideTimer) {
    return;
  }

  clearTimeout(menuPanelHideTimer);
  menuPanelHideTimer = null;
}

async function openMenuFloatingSurface(sender: Electron.WebContents, request: MenuFloatingSurfaceRequest) {
  if (isQuittingApp) {
    return;
  }

  keepMenuPanelOpenForInternalInteraction();
  const ownerWindow = BrowserWindow.fromWebContents(sender);
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return;
  }
  const parentKind = getMenuFloatingKindByWindow(ownerWindow);

  const size = getMenuFloatingSurfaceSize(request);
  const [x, y] = getMenuFloatingSurfacePosition(ownerWindow, request, size);
  const route = getMenuFloatingSurfaceRoute(request);
  const existingWindow = menuFloatingWindows.get(request.kind);
  if (existingWindow && !existingWindow.isDestroyed() && existingWindow.webContents.getURL().includes(route)) {
    menuFloatingRequests.set(request.kind, request);
    const currentBounds = existingWindow.getBounds();
    const [nextX, nextY] = getMenuFloatingSurfacePosition(ownerWindow, request, {
      width: currentBounds.width - MENU_SURFACE_OUTSET * 2,
      height: currentBounds.height - MENU_SURFACE_OUTSET * 2
    });
    if (currentBounds.x !== nextX || currentBounds.y !== nextY) {
      existingWindow.setBounds({ x: nextX, y: nextY, width: currentBounds.width, height: currentBounds.height });
    }
    showMenuFloatingWindowAbovePanel(existingWindow);
    menuFloatingParentKinds.set(request.kind, parentKind);
    startMenuFloatingPointerMonitor();
    return;
  }

  if (MENU_FLOATING_NESTED_KINDS.has(request.kind)) {
    closeNestedMenuFloatingWindows();
  } else {
    closeMenuFloatingWindows();
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
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  menuFloatingWindows.set(request.kind, floatingWindow);
  menuFloatingRequests.set(request.kind, request);
  menuFloatingParentKinds.set(request.kind, parentKind);
  nestedMenuHoverOutSince.delete(request.kind);
  startMenuFloatingPointerMonitor();

  floatingWindow.once('ready-to-show', () => {
    if (!floatingWindow.isDestroyed()) {
      showMenuFloatingWindowAbovePanel(floatingWindow);
    }
  });
  floatingWindow.on('blur', () => {
    if (menuPanelWindow && !menuPanelWindow.isDestroyed()) {
      scheduleMenuPanelBlurHide(menuPanelWindow);
    }
  });
  floatingWindow.on('closed', () => {
    const wasCurrentWindow = menuFloatingWindows.get(request.kind) === floatingWindow;
    if (wasCurrentWindow) {
      menuFloatingWindows.delete(request.kind);
      menuFloatingRequests.delete(request.kind);
      menuFloatingParentKinds.delete(request.kind);
      nestedMenuHoverOutSince.delete(request.kind);
    }
    stopMenuFloatingPointerMonitorIfIdle();
    if (wasCurrentWindow) {
      broadcastMenuFloatingSurfaceClosed(request.kind);
    }
  });

  try {
    await loadRenderer(floatingWindow, getMenuFloatingSurfaceRoute(request));
    if (!floatingWindow.isDestroyed() && !floatingWindow.isVisible()) {
      showMenuFloatingWindowAbovePanel(floatingWindow);
    }
  } catch (error: unknown) {
    // 浮层菜单会随 hover 快速替换；旧窗口在 loadURL 未完成前被关闭时，Electron 也会抛 ERR_FAILED。
    // 这不是渲染器加载故障，避免把正常的菜单切换误报成“加载失败”。
    if (isExpectedMenuFloatingLoadInterruption(request.kind, floatingWindow)) {
      return;
    }
    console.error('菜单浮层加载失败', error);
    if (!floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
  }
}

function isExpectedMenuFloatingLoadInterruption(kind: MenuFloatingSurfaceKind, floatingWindow: BrowserWindow) {
  const activeWindow = menuFloatingWindows.get(kind);
  return floatingWindow.isDestroyed() || activeWindow !== floatingWindow;
}

function showMenuFloatingWindowAbovePanel(floatingWindow: BrowserWindow) {
  floatingWindow.setAlwaysOnTop(true, 'pop-up-menu');
  if (process.platform === 'darwin') {
    floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // 菜单浮层依附主面板展示，不主动抢焦点；否则 macOS 会在主面板和浮层之间反复 blur/focus，表现成明显闪动。
  if (!floatingWindow.isVisible()) {
    floatingWindow.showInactive();
  }
  floatingWindow.moveTop();
  refreshMenuFloatingWindowPointerState(floatingWindow);
  setTimeout(() => refreshMenuFloatingWindowPointerState(floatingWindow), MENU_FLOATING_POINTER_POLL_MS);
}

function refreshMenuFloatingWindowPointerState(floatingWindow: BrowserWindow) {
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

function focusMenuFloatingWindowForPointer(floatingWindow: BrowserWindow) {
  if (floatingWindow.isDestroyed() || !floatingWindow.isVisible() || floatingWindow.isFocused()) {
    return;
  }

  // 鼠标进入独立 BrowserWindow 承载的二/三级菜单时，需要把焦点交给该窗口；
  // 否则 macOS 不会刷新真实 cursor 状态，链接 hover 也不会显示手指。
  keepMenuPanelOpenForInternalInteraction();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  floatingWindow.focus();
  refreshMenuFloatingWindowPointerState(floatingWindow);
}

function getMenuFloatingSurfaceRoute(request: MenuFloatingSurfaceRequest) {
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

function getMenuFloatingSurfaceSize(request: MenuFloatingSurfaceRequest) {
  const fallback = MENU_FLOATING_SURFACE_SIZES[request.kind];
  return {
    width: request.preferredWidth || fallback.width,
    height: request.preferredHeight || fallback.height
  };
}

function getMenuFloatingSurfacePosition(
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

function getMenuFloatingSurfaceAnchor(ownerWindow: BrowserWindow, request: MenuFloatingSurfaceRequest) {
  const ownerBounds = ownerWindow.getBounds();
  return {
    x: Math.round(ownerBounds.x + request.anchorRect.x),
    y: Math.round(ownerBounds.y + request.anchorRect.y),
    width: Math.round(request.anchorRect.width),
    height: Math.round(request.anchorRect.height)
  };
}

function getWindowSizeWithSurfaceOutset(size: { width: number; height: number }) {
  return {
    width: size.width + MENU_SURFACE_OUTSET * 2,
    height: size.height + MENU_SURFACE_OUTSET * 2
  };
}

function getMenuFloatingSurfaceAnchorPoint(ownerWindow: BrowserWindow, request: MenuFloatingSurfaceRequest) {
  const anchor = getMenuFloatingSurfaceAnchor(ownerWindow, request);
  return {
    x: anchor.x + Math.round(anchor.width / 2),
    y: anchor.y + Math.round(anchor.height / 2)
  };
}

function closeNestedMenuFloatingWindows() {
  for (const kind of MENU_FLOATING_NESTED_KINDS) {
    closeMenuFloatingWindows(kind);
  }
}

function getMenuFloatingKindByWindow(windowItem: BrowserWindow) {
  for (const [kind, floatingWindow] of menuFloatingWindows.entries()) {
    if (floatingWindow === windowItem) {
      return kind;
    }
  }

  return null;
}

function startMenuFloatingPointerMonitor() {
  if (menuFloatingPointerTimer) {
    return;
  }

  menuFloatingPointerTimer = setInterval(syncMenuFloatingWindowsByPointer, MENU_FLOATING_POINTER_POLL_MS);
}

function stopMenuFloatingPointerMonitorIfIdle() {
  if (!menuFloatingPointerTimer || menuFloatingWindows.size > 0) {
    return;
  }

  clearInterval(menuFloatingPointerTimer);
  menuFloatingPointerTimer = null;
  nestedMenuHoverOutSince.clear();
}

function syncMenuFloatingWindowsByPointer() {
  if (menuFloatingWindows.size === 0) {
    stopMenuFloatingPointerMonitorIfIdle();
    return;
  }

  const now = Date.now();
  for (const [kind, floatingWindow] of Array.from(menuFloatingWindows.entries())) {
    if (floatingWindow.isDestroyed() || !floatingWindow.isVisible()) {
      nestedMenuHoverOutSince.delete(kind);
      continue;
    }

    const pointerInsideChild = isCursorInsideWindow(floatingWindow);
    if (pointerInsideChild) {
      focusMenuFloatingWindowForPointer(floatingWindow);
      refreshMenuFloatingWindowPointerState(floatingWindow);
    }

    if (!MENU_FLOATING_NESTED_KINDS.has(kind)) {
      nestedMenuHoverOutSince.delete(kind);
      continue;
    }

    const parentKind = menuFloatingParentKinds.get(kind) ?? null;
    const parentWindow = parentKind ? menuFloatingWindows.get(parentKind) : menuPanelWindow;
    const pointerInsideParent = Boolean(parentWindow && !parentWindow.isDestroyed() && parentWindow.isVisible() && isCursorInsideWindow(parentWindow));
    const pointerInsideWindowBridge = Boolean(parentWindow && !parentWindow.isDestroyed() && parentWindow.isVisible() && isCursorInsideMenuWindowBridge(parentWindow, floatingWindow));

    // 三级菜单跨 BrowserWindow 展示，mouseleave 不会天然跨窗口冒泡；这里用窗口边界统一收口。
    if (pointerInsideChild || pointerInsideParent || pointerInsideWindowBridge) {
      nestedMenuHoverOutSince.delete(kind);
      continue;
    }

    const hoverOutStartedAt = nestedMenuHoverOutSince.get(kind) || now;
    nestedMenuHoverOutSince.set(kind, hoverOutStartedAt);
    if (now - hoverOutStartedAt >= MENU_NESTED_HOVER_CLOSE_DELAY_MS) {
      closeMenuFloatingWindows(kind);
    }
  }
}

function closeMenuFloatingWindows(kind?: MenuFloatingSurfaceKind) {
  const targets = kind
    ? [[kind, menuFloatingWindows.get(kind)] as const]
    : Array.from(menuFloatingWindows.entries());

  for (const [targetKind, floatingWindow] of targets) {
    if (!floatingWindow) {
      continue;
    }
    menuFloatingWindows.delete(targetKind);
    menuFloatingRequests.delete(targetKind);
    menuFloatingParentKinds.delete(targetKind);
    nestedMenuHoverOutSince.delete(targetKind);
    if (!floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
    broadcastMenuFloatingSurfaceClosed(targetKind);
  }
  stopMenuFloatingPointerMonitorIfIdle();
}

function broadcastMenuFloatingSurfaceClosed(kind: MenuFloatingSurfaceKind) {
  for (const windowItem of BrowserWindow.getAllWindows()) {
    sendWindowMessage(windowItem, 'menu-floating:closed', kind);
  }
}

function broadcastDefaultMessagesUpdated() {
  const messages = store.getDefaultMessages();
  for (const windowItem of BrowserWindow.getAllWindows()) {
    sendWindowMessage(windowItem, 'default-messages:updated', messages);
  }
}

function broadcastDraftReminderUpdated(id: string) {
  const reminder = draftReminders.get(id) || null;
  for (const windowItem of BrowserWindow.getAllWindows()) {
    sendWindowMessage(windowItem, 'reminders:draft-updated', id, reminder);
  }
}

function broadcastAppSettingsUpdated() {
  const settings = store.getAppSettings();
  for (const windowItem of BrowserWindow.getAllWindows()) {
    sendWindowMessage(windowItem, 'app-settings:updated', settings);
  }
}

function getMenuPanelPosition(windowItem: BrowserWindow): [number, number] {
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

async function showReminderWindows(reminder: Reminder, options: ReminderWindowOptions = {}) {
  dismissReminderWindows(reminder.id);

  const displays = options.displays ?? selectDisplays();
  const payload = options.payload ?? createReminderPayload(reminder, new Date());
  const windows = displays.map((display) => createReminderWindowForDisplay(reminder, display, payload));

  activeReminderSessions.set(reminder.id, { reminder, displays, payload });
  reminderWindows.set(reminder.id, windows);
  startReminderWindowReassertTimer();
  updateReminderEscapeShortcut();
  const shouldSleepDisplayAfterIdle = options.lockScreenAfterIdle ?? store.getAppSettings().lockScreenAfterIdle;
  if (shouldSleepDisplayAfterIdle) {
    const displaySleepTimer = setTimeout(() => {
      void sleepDisplays();
      displaySleepTimers.delete(reminder.id);
    }, 10_000);
    displaySleepTimers.set(reminder.id, displaySleepTimer);
  }

  if (reminder.repeatUntilDismissed) {
    const timer = setInterval(() => {
      const existingWindows = reminderWindows.get(reminder.id) || [];
      if (existingWindows.length === 0) {
        clearInterval(timer);
        reminderRepeatTimers.delete(reminder.id);
        return;
      }
      void showReminderWindows(reminder);
    }, reminder.repeatIntervalMinutes * 60_000);
    reminderRepeatTimers.set(reminder.id, timer);
  }
}

function createReminderWindowForDisplay(reminder: Reminder, display: DisplayInfo, payload: ReminderPayload) {
  const reminderWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    // macOS 原生 fullscreen 会创建或激活独立 Space；提醒只需要覆盖当前桌面。
    fullscreen: false,
    fullscreenable: false,
    transparent: true,
    focusable: true,
    acceptFirstMouse: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: reminder.name,
    icon: createAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 亮屏或解锁后系统可能重排窗口层级；提醒窗口需要压在普通应用之上，但不能盖住截图框选等系统级浮层。
  reminderWindow.setAlwaysOnTop(true, REMINDER_WINDOW_TOP_LEVEL);
  const reminderWebContentsId = reminderWindow.webContents.id;
  reminderPayloads.set(reminderWebContentsId, payload);
  reminderWindow.once('ready-to-show', () => {
    if (reminderWindow.isDestroyed()) {
      return;
    }
    showReminderOverlayWindow(reminderWindow, { focus: true });
    broadcastReminderOverlayVisibility();
  });
  reminderWindow.on('closed', () => {
    // closed 触发时 BrowserWindow 的原生对象已经销毁，不能再访问 webContents。
    reminderPayloads.delete(reminderWebContentsId);
    forgetClosedReminderWindow(reminder.id, reminderWindow);
    broadcastReminderOverlayVisibility();
  });
  void loadRenderer(reminderWindow, 'reminder')
    .then(() => {
      // 透明浮层可能不触发 ready-to-show，加载完成后兜底展示，避免提醒静默丢失。
      if (!reminderWindow.isDestroyed() && !reminderWindow.isVisible()) {
        showReminderOverlayWindow(reminderWindow, { focus: true });
        broadcastReminderOverlayVisibility();
      }
    })
    .catch((error: unknown) => {
      console.error('提醒浮层加载失败', error);
    });

  return reminderWindow;
}

function reassertActiveReminderWindows() {
  if (activeReminderSessions.size === 0) {
    stopReminderWindowReassertTimer();
    return;
  }

  for (const [reminderId, session] of activeReminderSessions) {
    const existingWindows = reminderWindows.get(reminderId) || [];
    const liveWindows = existingWindows.filter((windowItem) => !windowItem.isDestroyed());
    const shouldRecreateWindows = liveWindows.length !== session.displays.length;

    if (shouldRecreateWindows) {
      for (const windowItem of liveWindows) {
        windowItem.close();
      }
      const restoredWindows = session.displays.map((display) => (
        createReminderWindowForDisplay(session.reminder, display, session.payload)
      ));
      reminderWindows.set(reminderId, restoredWindows);
      continue;
    }

    for (const windowItem of liveWindows) {
      showReminderOverlayWindow(windowItem, { focus: false });
    }
  }

  updateReminderEscapeShortcut();
  broadcastReminderOverlayVisibility();
}

function startReminderWindowReassertTimer() {
  if (reminderWindowReassertTimer) {
    return;
  }

  // 系统只熄显示器时不一定有 resume/unlock 事件，活动提醒需要自己兜底补回窗口层级。
  reminderWindowReassertTimer = setInterval(() => {
    reassertActiveReminderWindows();
  }, REMINDER_WINDOW_REASSERT_INTERVAL_MS);
}

function stopReminderWindowReassertTimer() {
  if (!reminderWindowReassertTimer) {
    return;
  }

  clearInterval(reminderWindowReassertTimer);
  reminderWindowReassertTimer = null;
}

function showReminderOverlayWindow(windowItem: BrowserWindow, options: { focus: boolean }) {
  windowItem.setAlwaysOnTop(true, REMINDER_WINDOW_TOP_LEVEL);

  if (process.platform === 'darwin') {
    windowItem.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (options.focus) {
      app.focus({ steal: true });
    }
    windowItem.show();
    windowItem.moveTop();
    if (options.focus) {
      // 新提醒出现时接一次焦点，避免用户误点到后面的窗口；后续层级兜底不反复抢焦点。
      windowItem.focus();
    }
    return;
  }

  windowItem.show();
  if (options.focus) {
    windowItem.focus();
  }
}

function selectDisplays(): DisplayInfo[] {
  const displays = getDisplayInfos();
  const selectedDisplayIds = store.getAppSettings().selectedDisplayIds;
  const selected = displays.filter((display) => selectedDisplayIds.includes(display.id));
  if (selected.length > 0) {
    return selected;
  }

  const primary = displays.find((display) => display.isPrimary) || displays[0];
  return primary ? [primary] : [];
}

function dismissReminderWindows(reminderId: string) {
  activeReminderSessions.delete(reminderId);
  if (activeReminderSessions.size === 0) {
    stopReminderWindowReassertTimer();
  }

  const repeatTimer = reminderRepeatTimers.get(reminderId);
  if (repeatTimer) {
    clearInterval(repeatTimer);
    reminderRepeatTimers.delete(reminderId);
  }

  const displaySleepTimer = displaySleepTimers.get(reminderId);
  if (displaySleepTimer) {
    clearTimeout(displaySleepTimer);
    displaySleepTimers.delete(reminderId);
  }

  const windows = reminderWindows.get(reminderId) || [];
  for (const windowItem of windows) {
    if (!windowItem.isDestroyed()) {
      windowItem.close();
    }
  }
  reminderWindows.delete(reminderId);
  updateReminderEscapeShortcut();
  broadcastReminderOverlayVisibility();
}

function clearAllDisplaySleepTimers() {
  for (const timer of displaySleepTimers.values()) {
    clearTimeout(timer);
  }
  displaySleepTimers.clear();
}

function clearAllReminderRepeatTimers() {
  for (const timer of reminderRepeatTimers.values()) {
    clearInterval(timer);
  }
  reminderRepeatTimers.clear();
}

function closeAllReminderWindowsForQuit() {
  clearAllReminderRepeatTimers();
  clearAllDisplaySleepTimers();

  for (const windows of reminderWindows.values()) {
    for (const windowItem of windows) {
      if (!windowItem.isDestroyed()) {
        windowItem.close();
      }
    }
  }

  reminderWindows.clear();
  reminderPayloads.clear();
  activeReminderSessions.clear();
  stopReminderWindowReassertTimer();
  previewReminderSourceIds.clear();
}

async function dismissReminderById(reminderId: string) {
  dismissReminderWindows(reminderId);
  if (consumePreviewReminderId(reminderId)) {
    return;
  }
  await store.markCompletedOnDismiss(consumeReminderActionId(reminderId));
}

async function dismissOpenRemindersFromShortcut() {
  const reminderIds = Array.from(reminderWindows.keys());
  for (const reminderId of reminderIds) {
    await dismissReminderById(reminderId);
  }
}

function updateOpenReminderPayloads(reminders: Reminder[]) {
  const remindersById = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  for (const [reminderId, windows] of reminderWindows) {
    const reminder = remindersById.get(reminderId);
    if (!reminder) {
      continue;
    }

    const payload = createReminderPayload(reminder, new Date());
    const activeSession = activeReminderSessions.get(reminderId);
    if (activeSession) {
      activeReminderSessions.set(reminderId, {
        ...activeSession,
        reminder,
        payload
      });
    }
    for (const windowItem of windows) {
      if (!canSendToWindow(windowItem)) {
        continue;
      }
      reminderPayloads.set(windowItem.webContents.id, payload);
      sendWindowMessage(windowItem, 'reminder-payload:updated', payload);
      windowItem.setTitle(reminder.name);
    }
  }
}

function forgetClosedReminderWindow(reminderId: string, closedWindow: BrowserWindow) {
  const windows = reminderWindows.get(reminderId);
  if (!windows) {
    return;
  }

  const remainingWindows = windows.filter((windowItem) => windowItem !== closedWindow && !windowItem.isDestroyed());
  if (remainingWindows.length === 0) {
    reminderWindows.delete(reminderId);
    updateReminderEscapeShortcut();
    return;
  }

  reminderWindows.set(reminderId, remainingWindows);
  updateReminderEscapeShortcut();
}

function hasVisibleReminderWindow() {
  for (const windows of reminderWindows.values()) {
    if (windows.some((windowItem) => !windowItem.isDestroyed() && windowItem.isVisible())) {
      return true;
    }
  }
  return false;
}

function hasOpenReminderWindow(reminderId: string) {
  const windows = reminderWindows.get(reminderId) || [];
  return windows.some((windowItem) => !windowItem.isDestroyed());
}

function broadcastReminderOverlayVisibility() {
  const visible = hasVisibleReminderWindow();
  if (!menuPanelWindow || menuPanelWindow.isDestroyed()) {
    return;
  }
  sendWindowMessage(menuPanelWindow, 'reminder-overlay:visibility-changed', visible);
}

function canSendToWindow(windowItem: BrowserWindow) {
  // Electron 的窗口关闭过程中，BrowserWindow 对象和 webContents 的销毁时序不完全同步，发送前必须同时检查。
  return !windowItem.isDestroyed() && !windowItem.webContents.isDestroyed();
}

function sendWindowMessage(windowItem: BrowserWindow, channel: string, ...args: unknown[]) {
  if (!canSendToWindow(windowItem)) {
    return false;
  }

  try {
    windowItem.webContents.send(channel, ...args);
    return true;
  } catch (error: unknown) {
    console.warn('窗口消息发送失败', { channel, error });
    return false;
  }
}

async function sleepDisplays() {
  if (process.platform === 'darwin') {
    await runSystemCommand('/usr/bin/pmset', ['displaysleepnow'], '自动熄屏失败');
    return;
  }

  if (process.platform === 'win32') {
    // Windows 没有稳定的独立命令行入口，借助系统自带 PowerShell 调用 user32 关闭显示器。
    await runSystemCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `
$signature = @"
using System;
using System.Runtime.InteropServices;
public static class XiabanlaDisplayPower {
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
}
"@
Add-Type -TypeDefinition $signature;
[XiabanlaDisplayPower]::SendMessage([IntPtr](-1), 0x0112, [IntPtr]0xF170, [IntPtr]2) | Out-Null
`.trim()
    ], '自动熄屏失败');
  }
}

function runSystemCommand(command: string, args: string[], errorMessage: string) {
  return new Promise<void>((resolve) => {
    execFile(command, args, (error) => {
      if (error) {
        console.warn(errorMessage, error);
      }
      resolve();
    });
  });
}

async function loadRenderer(windowItem: BrowserWindow, route = '') {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await windowItem.loadURL(`${process.env.VITE_DEV_SERVER_URL}${route ? `/#/${route}` : ''}`);
    return;
  }

  await windowItem.loadFile(join(__dirname, '../../dist/index.html'), {
    hash: route ? `/${route}` : ''
  });
}

function registerIpc() {
  ipcMain.handle('reminders:get', async () => {
    await store.reconcileForToday();
    return store.getAll();
  });
  ipcMain.handle('reminders:save', async (_event, reminder: Reminder) => {
    const savedReminder = await store.save(reminder);
    return savedReminder;
  });
  ipcMain.handle('reminders:draft:get', (_event, id: string) => draftReminders.get(id) || null);
  ipcMain.handle('reminders:draft:save', (_event, reminder: Reminder) => {
    draftReminders.set(reminder.id, reminder);
    broadcastDraftReminderUpdated(reminder.id);
    return reminder;
  });
  ipcMain.handle('reminders:draft:delete', (_event, id: string) => {
    draftReminders.delete(id);
    broadcastDraftReminderUpdated(id);
  });
  ipcMain.handle('reminders:delete', async (_event, id: string) => {
    dismissReminderWindows(id);
    await store.delete(id);
  });
  ipcMain.handle('reminders:toggle', async (_event, id: string, enabled: boolean) => {
    await store.toggle(id, enabled);
  });
  ipcMain.handle('displays:get', () => getDisplayInfos());
  ipcMain.handle('reminders:trigger-now', async (_event, id: string) => scheduler.triggerNow(id));
  ipcMain.handle('reminders:trigger-preview', async (_event, id: string) => {
    const reminder = store.getAll().find((item) => item.id === id);
    if (!reminder) {
      throw new Error('提醒不存在');
    }

    const previewReminder = {
      ...reminder,
      id: `${reminder.id}:preview`,
      // 预览只关闭重复弹出；自动熄屏需要跟随全局设置，方便用户直接验证真实效果。
      repeatUntilDismissed: false
    };
    const displays = selectDisplays();
    const payload = createReminderPayload(previewReminder, new Date(), {
      title: REMINDER_PREVIEW_TEXT,
      message: REMINDER_PREVIEW_TEXT
    });

    previewReminderSourceIds.set(previewReminder.id, reminder.id);
    await showReminderWindows(previewReminder, { displays, payload });
    return {
      payload,
      displays
    };
  });
  ipcMain.handle('reminders:snooze', async (_event, id: string, minutes: number) => {
    dismissReminderWindows(id);
    if (consumePreviewReminderId(id)) {
      return;
    }
    await scheduler.snooze(consumeReminderActionId(id), minutes);
  });
  ipcMain.handle('reminders:dismiss', async (_event, id: string) => {
    await dismissReminderById(id);
  });
  ipcMain.handle('reminders:enter', async (_event, id: string) => {
    dismissReminderWindows(id);
    if (consumePreviewReminderId(id)) {
      showMenuPanel();
      return;
    }
    await store.markCompletedOnDismiss(consumeReminderActionId(id));
    showMenuPanel();
  });
  ipcMain.handle('external:list', () => listExternalEvents());
  ipcMain.handle('external:link', async (_event, reminderId: string, eventId: string) => {
    await linkExternalEvent(reminderId, eventId);
  });
  ipcMain.handle('external:sync', () => syncExternalSourcesHandler());
  ipcMain.handle('settings:default-messages:get', () => store.getDefaultMessages());
  ipcMain.handle('settings:default-messages:save', async (_event, messages) => {
    const savedMessages = await store.saveDefaultMessages(messages);
    broadcastDefaultMessagesUpdated();
    return savedMessages;
  });
  ipcMain.handle('settings:default-messages:reset', async () => {
    const savedMessages = await store.resetDefaultMessages();
    broadcastDefaultMessagesUpdated();
    return savedMessages;
  });
  ipcMain.handle('settings:auto-launch:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('settings:auto-launch:set', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('settings:app:get', () => store.getAppSettings());
  ipcMain.handle('settings:lock-screen-after-idle:set', async (_event, enabled: boolean) => {
    const settings = await store.setLockScreenAfterIdle(enabled);
    broadcastAppSettingsUpdated();
    return settings;
  });
  ipcMain.handle('settings:selected-display-ids:set', async (_event, displayIds: string[]) => {
    const settings = await store.setSelectedDisplayIds(displayIds);
    broadcastAppSettingsUpdated();
    return settings;
  });
  ipcMain.handle('app:about-info', () => ({
    version: app.getVersion(),
    currentYear: new Date().getFullYear()
  }));
  ipcMain.handle('app:open-external-link', async (_event, url: string) => {
    if (!ALLOWED_EXTERNAL_LINKS.has(url)) {
      throw new Error('不支持打开此链接');
    }

    await shell.openExternal(url);
  });
  ipcMain.handle('menu-panel:hide', () => {
    hideAppToBackground();
  });
  ipcMain.handle('menu-panel:keep-open', () => {
    keepMenuPanelOpenForInternalInteraction();
  });
  ipcMain.handle('menu-floating:open', (event, request: MenuFloatingSurfaceRequest) => (
    openMenuFloatingSurface(event.sender, request)
  ));
  ipcMain.handle('menu-floating:close', (_event, kind?: MenuFloatingSurfaceKind) => {
    closeMenuFloatingWindows(kind);
  });
  ipcMain.handle('reminders:request-delete', (_event, id: string) => {
    if (!menuPanelWindow || !sendWindowMessage(menuPanelWindow, 'reminders:delete-requested', id)) {
      throw new Error('提醒面板未打开，无法撤销删除');
    }
    closeMenuFloatingWindows();
  });
  ipcMain.handle('app:hide-to-background', () => {
    hideAppToBackground();
  });
  ipcMain.handle('app:quit', () => {
    requestAppQuit();
  });
  ipcMain.handle('reminder-payload:get', (event) => reminderPayloads.get(event.sender.id) || null);
  ipcMain.handle('reminder-overlay:mouse-through:set', (event, enabled: boolean) => {
    setReminderOverlayMouseThrough(event.sender, enabled);
  });

  store.subscribe((reminders) => {
    updateOpenReminderPayloads(reminders);
    for (const windowItem of BrowserWindow.getAllWindows()) {
      sendWindowMessage(windowItem, 'reminders:updated', reminders);
    }
  });
}

function setReminderOverlayMouseThrough(sender: Electron.WebContents, enabled: boolean) {
  if (!reminderPayloads.has(sender.id)) {
    return;
  }

  const windowItem = BrowserWindow.fromWebContents(sender);
  if (!windowItem || windowItem.isDestroyed()) {
    return;
  }

  windowItem.setIgnoreMouseEvents(enabled, { forward: true });
}

async function linkExternalEvent(reminderId: string, eventId: string) {
  const listResult = await listExternalEvents();
  const event = listResult.events.find((item) => `${item.provider}:${item.id}` === eventId);
  const reminder = store.getAll().find((item) => item.id === reminderId);
  if (!event || !reminder) {
    throw new Error(listResult.message || '没有找到可绑定的外部提醒');
  }

  await store.save({
    ...reminder,
    ...createExternalReminderPatch(event, reminder.linkedExternalSource)
  });
}

async function syncExternalSourcesHandler(): Promise<SyncResult> {
  const { reminders, result } = await syncExternalSources(store.getAll());
  await store.updateAll(reminders);
  return result;
}

function broadcastReminders() {
  for (const windowItem of BrowserWindow.getAllWindows()) {
    sendWindowMessage(windowItem, 'reminders:updated', store.getAll());
  }
}

function consumeReminderActionId(reminderId: string) {
  const actionReminderId = previewReminderSourceIds.get(reminderId) || reminderId;
  previewReminderSourceIds.delete(reminderId);
  return actionReminderId;
}

function consumePreviewReminderId(reminderId: string) {
  const isPreviewReminder = previewReminderSourceIds.has(reminderId) || reminderId.endsWith(':preview');
  previewReminderSourceIds.delete(reminderId);
  return isPreviewReminder;
}

function createTrayIcon() {
  const icon = createIconFromSvgFile(getRuntimeBuildIconPath(TRAY_ICON_FILE));
  if (!icon.isEmpty()) {
    const size = process.platform === 'darwin' ? 18 : 32;
    return icon.resize({ width: size, height: size });
  }

  if (process.platform === 'darwin') {
    const fallbackIcon = nativeImage.createFromNamedImage('NSActionTemplate');
    if (!fallbackIcon.isEmpty()) {
      fallbackIcon.setTemplateImage(true);
      return fallbackIcon;
    }
  }

  return createAppIcon();
}

function createAppIcon() {
  const icon = nativeImage.createFromPath(getRuntimeBuildIconPath(getThemeAppIconFile()));
  if (!icon.isEmpty()) {
    return icon;
  }

  return nativeImage.createFromPath(getRuntimeBuildIconPath(LIGHT_APP_ICON_FILE));
}

function getThemeAppIconFile() {
  return nativeTheme.shouldUseDarkColors ? DARK_APP_ICON_FILE : LIGHT_APP_ICON_FILE;
}

function createIconFromSvgFile(filePath: string) {
  if (!existsSync(filePath)) {
    return nativeImage.createEmpty();
  }

  const svg = readFileSync(filePath, 'utf8');
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function getRuntimeBuildIconPath(fileName: string) {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icons', fileName);
  }

  return join(__dirname, '..', '..', 'build', fileName);
}
