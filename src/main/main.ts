import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Reminder, ReminderPayload } from '../shared/types.js';
import { registerApplicationMenu } from './applicationMenu.js';
import { registerIpcHandlers } from './ipcHandlers.js';
import { MenuPanelController } from './menuPanelController.js';
import { MenuFloatingController } from './menuFloatingController.js';
import { loadRenderer as loadRendererForWindow } from './rendererLoader.js';
import { ReminderOverlayController } from './reminderOverlayController.js';
import { ReminderScheduler } from './scheduler.js';
import { StatusBarEntry } from './statusBarEntry.js';
import { ReminderStore } from './store.js';
import { sendWindowMessage } from './windowMessenger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const store = new ReminderStore();

let scheduler: ReminderScheduler;
const reminderPayloads = new Map<number, ReminderPayload>();
const previewReminderSourceIds = new Map<string, string>();
const draftReminders = new Map<string, Reminder>();
let isQuittingApp = false;

let statusBarEntry: StatusBarEntry;
let menuPanel: MenuPanelController;

const loadRenderer = (windowItem: BrowserWindow, route = '') => loadRendererForWindow(__dirname, windowItem, route);
const reminderOverlays = new ReminderOverlayController({
  dirname: __dirname,
  store,
  reminderPayloads,
  previewReminderSourceIds,
  getMenuPanelWindow: () => menuPanel.getWindow(),
  loadRenderer,
  sendWindowMessage
});
const menuFloating = new MenuFloatingController({
  dirname: __dirname,
  isQuitting: () => isQuittingApp,
  getMenuPanelWindow: () => menuPanel.getWindow(),
  keepMenuPanelOpenForInternalInteraction: () => menuPanel.keepOpenForInternalInteraction(),
  scheduleMenuPanelBlurHide: (windowItem) => menuPanel.scheduleBlurHide(windowItem),
  clearMenuPanelHideTimer: () => menuPanel.clearHideTimer(),
  loadRenderer,
  sendWindowMessage
});
menuPanel = new MenuPanelController({
  dirname: __dirname,
  isQuitting: () => isQuittingApp,
  getTray: () => statusBarEntry.getTray(),
  hasVisibleReminderOverlay: () => reminderOverlays.hasVisibleWindow(),
  broadcastOverlayVisibility: () => reminderOverlays.broadcastOverlayVisibility(),
  closeFloatingWindows: () => menuFloating.closeWindows(),
  getCursorInsideFloatingWindow: () => menuFloating.getCursorInsideWindow(),
  isCursorInsideFloatingWindowBridge: () => menuFloating.isCursorInsideWindowBridge(),
  isManagedFloatingWindow: (windowItem) => menuFloating.isManagedWindow(windowItem),
  showFloatingWindowAbovePanel: (windowItem) => menuFloating.showWindowAbovePanel(windowItem),
  loadRenderer,
  requestBeforeHide: requestMenuPanelBeforeHide,
  sendWindowMessage
});
statusBarEntry = new StatusBarEntry({
  dirname: __dirname,
  onToggleMenuPanel: () => menuPanel.toggle(),
  onShowMenuPanelWithSettings: () => menuPanel.showWithSettings()
});

app.setName('下班啦');
if (process.platform === 'darwin') {
  app.dock?.hide();
}

void app.whenReady().then(async () => {
  await store.init();
  scheduler = new ReminderScheduler(
    store,
    (reminder, options) => reminderOverlays.showWindows(reminder, options),
    (reminderId) => reminderOverlays.hasOpenWindow(reminderId)
  );
  registerIpcHandlers({
    store,
    scheduler,
    draftReminders,
    reminderPayloads,
    previewReminderSourceIds,
    getMenuPanelWindow: () => menuPanel.getWindow(),
    selectDisplays: () => reminderOverlays.selectDisplays(),
    showReminderWindows: (reminder, options) => reminderOverlays.showWindows(reminder, options),
    dismissReminderWindows: (reminderId) => reminderOverlays.dismissWindows(reminderId),
    dismissReminderById: (reminderId) => reminderOverlays.dismissById(reminderId),
    showMenuPanel: () => menuPanel.show(),
    hideAppToBackground: () => menuPanel.hideToBackground(),
    keepMenuPanelOpenForInternalInteraction: () => menuPanel.keepOpenForInternalInteraction(),
    openMenuFloatingSurface: (sender, request) => menuFloating.openSurface(sender, request),
    closeMenuFloatingWindows: (kind) => menuFloating.closeWindows(kind),
    requestAppQuit,
    broadcastDefaultMessagesUpdated,
    broadcastDraftReminderUpdated,
    broadcastAppSettingsUpdated,
    updateOpenReminderPayloads: (reminders) => reminderOverlays.updateOpenPayloads(reminders),
    sendWindowMessage
  });
  statusBarEntry.register();
  registerApplicationMenu(() => menuPanel.show());
  statusBarEntry.registerThemeIconUpdates();
  registerPowerRecoveryHandlers();
  statusBarEntry.applyRuntimeIcons();
  scheduler.start();

  screen.on('display-added', () => broadcastReminders());
  screen.on('display-removed', () => broadcastReminders());
  screen.on('display-metrics-changed', () => broadcastReminders());
});

app.on('window-all-closed', () => {
  // 托盘应用需要在设置窗口关闭后继续保留调度器和菜单栏入口。
});

app.on('browser-window-blur', (_event, windowItem) => {
  const menuPanelWindow = menuPanel.getWindow();
  if (!menuPanel.isManagedWindow(windowItem) || !menuPanelWindow || menuPanelWindow.isDestroyed()) {
    return;
  }

  if (reminderOverlays.hasVisibleWindow()) {
    return;
  }

  menuPanel.scheduleBlurHide(menuPanelWindow);
});

if (process.platform === 'darwin') {
  app.on('did-resign-active', () => {
    menuPanel.hideAfterAppDeactivation();
  });
}

app.on('before-quit', () => {
  isQuittingApp = true;
  statusBarEntry.setQuitting(true);
  cleanupBeforeQuit();
});

if (process.platform === 'darwin') {
  process.on('SIGUSR1', () => {
    // 原生菜单栏 helper 只负责转发点击事件，开关状态统一由主进程判断。
    menuPanel.toggle();
  });
  process.on('SIGUSR2', () => {
    menuPanel.showWithSettings();
  });
}

function registerPowerRecoveryHandlers() {
  const recoverReminderOverlays = () => {
    reminderOverlays.reassertActiveWindows();
  };

  powerMonitor.on('resume', recoverReminderOverlays);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    powerMonitor.on('unlock-screen', recoverReminderOverlays);
  }
  if (process.platform === 'darwin') {
    powerMonitor.on('user-did-become-active', recoverReminderOverlays);
  }
}

function requestAppQuit() {
  isQuittingApp = true;
  statusBarEntry.setQuitting(true);
  cleanupBeforeQuit();
  app.quit();
}

function requestMenuPanelBeforeHide(windowItem: BrowserWindow) {
  if (windowItem.isDestroyed() || windowItem.webContents.isDestroyed()) {
    return Promise.resolve(true);
  }

  const requestId = randomUUID();
  const resultChannel = `menu-panel:before-hide-result:${requestId}`;

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(resultChannel);
      resolve(true);
    }, 700);

    ipcMain.once(resultChannel, (_event, canHide: boolean) => {
      clearTimeout(timeout);
      resolve(Boolean(canHide));
    });

    if (!sendWindowMessage(windowItem, 'menu-panel:before-hide', requestId)) {
      clearTimeout(timeout);
      ipcMain.removeAllListeners(resultChannel);
      resolve(true);
    }
  });
}

function cleanupBeforeQuit() {
  menuPanel.cleanup();
  reminderOverlays.closeAllForQuit();
  statusBarEntry.cleanup();
  globalShortcut.unregisterAll();
  scheduler?.stop();
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

function broadcastReminders() {
  for (const windowItem of BrowserWindow.getAllWindows()) {
    sendWindowMessage(windowItem, 'reminders:updated', store.getAll());
  }
}
