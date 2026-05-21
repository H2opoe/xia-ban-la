import electron from 'electron/main';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { createReminderPayload } from '../shared/reminderPayload.js';
import type { DisplayInfo, Reminder, ReminderPayload } from '../shared/types.js';
import { getDisplayInfos } from './displays.js';
import { createAppIcon } from './icons.js';
import type { ReminderActionSession } from './reminderActionSession.js';
import type { ReminderStore } from './store.js';

const { app, BrowserWindow, globalShortcut } = electron;
type BrowserWindow = Electron.BrowserWindow;

const REMINDER_ESCAPE_SHORTCUT = 'Escape';
const REMINDER_WINDOW_REASSERT_INTERVAL_MS = 3_000;
const REMINDER_WINDOW_TOP_LEVEL = 'floating';

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

type ReminderOverlayControllerOptions = {
  dirname: string;
  store: ReminderStore;
  reminderPayloads: Map<number, ReminderPayload>;
  reminderActionSession: ReminderActionSession;
  getMenuPanelWindow: () => BrowserWindow | null;
  loadRenderer: (windowItem: BrowserWindow, route?: string) => Promise<void>;
  sendWindowMessage: (windowItem: BrowserWindow, channel: string, ...args: unknown[]) => boolean;
};

export class ReminderOverlayController {
  private readonly reminderWindows = new Map<string, BrowserWindow[]>();
  private readonly activeReminderSessions = new Map<string, ActiveReminderSession>();
  private readonly reminderRepeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly displaySleepTimers = new Map<string, NodeJS.Timeout>();
  private reminderWindowReassertTimer: NodeJS.Timeout | null = null;
  private reminderEscapeShortcutRegistered = false;

  constructor(private readonly options: ReminderOverlayControllerOptions) {}

  async showWindows(reminder: Reminder, options: ReminderWindowOptions = {}) {
    this.dismissWindows(reminder.id);

    const displays = options.displays ?? this.selectDisplays();
    const payload = options.payload ?? createReminderPayload(reminder, new Date());
    const windows = displays.map((display) => this.createWindowForDisplay(reminder, display, payload));

    this.activeReminderSessions.set(reminder.id, { reminder, displays, payload });
    this.reminderWindows.set(reminder.id, windows);
    this.startWindowReassertTimer();
    this.updateEscapeShortcut();
    const shouldSleepDisplayAfterIdle = options.lockScreenAfterIdle
      ?? this.options.store.getAppSettings().lockScreenAfterIdle;
    if (shouldSleepDisplayAfterIdle) {
      const displaySleepTimer = setTimeout(() => {
        void this.sleepDisplays();
        this.displaySleepTimers.delete(reminder.id);
      }, 10_000);
      this.displaySleepTimers.set(reminder.id, displaySleepTimer);
    }

    if (reminder.repeatUntilDismissed) {
      const timer = setInterval(() => {
        const existingWindows = this.reminderWindows.get(reminder.id) || [];
        if (existingWindows.length === 0) {
          clearInterval(timer);
          this.reminderRepeatTimers.delete(reminder.id);
          return;
        }
        void this.showWindows(reminder);
      }, reminder.repeatIntervalMinutes * 60_000);
      this.reminderRepeatTimers.set(reminder.id, timer);
    }
  }

  reassertActiveWindows() {
    if (this.activeReminderSessions.size === 0) {
      this.stopWindowReassertTimer();
      return;
    }

    for (const [reminderId, session] of this.activeReminderSessions) {
      const existingWindows = this.reminderWindows.get(reminderId) || [];
      const liveWindows = existingWindows.filter((windowItem) => !windowItem.isDestroyed());
      const shouldRecreateWindows = liveWindows.length !== session.displays.length;

      if (shouldRecreateWindows) {
        for (const windowItem of liveWindows) {
          windowItem.close();
        }
        const restoredWindows = session.displays.map((display) => (
          this.createWindowForDisplay(session.reminder, display, session.payload)
        ));
        this.reminderWindows.set(reminderId, restoredWindows);
        continue;
      }

      for (const windowItem of liveWindows) {
        this.showOverlayWindow(windowItem, { focus: false });
      }
    }

    this.updateEscapeShortcut();
    this.broadcastOverlayVisibility();
  }

  selectDisplays(): DisplayInfo[] {
    const displays = getDisplayInfos();
    const selectedDisplayIds = this.options.store.getAppSettings().selectedDisplayIds;
    const selected = displays.filter((display) => selectedDisplayIds.includes(display.id));
    if (selected.length > 0) {
      return selected;
    }

    const primary = displays.find((display) => display.isPrimary) || displays[0];
    return primary ? [primary] : [];
  }

  dismissWindows(reminderId: string) {
    this.activeReminderSessions.delete(reminderId);
    if (this.activeReminderSessions.size === 0) {
      this.stopWindowReassertTimer();
    }

    const repeatTimer = this.reminderRepeatTimers.get(reminderId);
    if (repeatTimer) {
      clearInterval(repeatTimer);
      this.reminderRepeatTimers.delete(reminderId);
    }

    const displaySleepTimer = this.displaySleepTimers.get(reminderId);
    if (displaySleepTimer) {
      clearTimeout(displaySleepTimer);
      this.displaySleepTimers.delete(reminderId);
    }

    const windows = this.reminderWindows.get(reminderId) || [];
    for (const windowItem of windows) {
      if (!windowItem.isDestroyed()) {
        windowItem.close();
      }
    }
    this.reminderWindows.delete(reminderId);
    this.updateEscapeShortcut();
    this.broadcastOverlayVisibility();
  }

  async dismissById(reminderId: string) {
    this.dismissWindows(reminderId);
    if (this.options.reminderActionSession.consumePreview(reminderId)) {
      return;
    }
    await this.options.store.markCompletedOnDismiss(this.options.reminderActionSession.consumeActionId(reminderId));
  }

  updateOpenPayloads(reminders: Reminder[]) {
    const remindersById = new Map(reminders.map((reminder) => [reminder.id, reminder]));
    for (const [reminderId, windows] of this.reminderWindows) {
      const reminder = remindersById.get(reminderId);
      if (!reminder) {
        continue;
      }

      const payload = createReminderPayload(reminder, new Date());
      const activeSession = this.activeReminderSessions.get(reminderId);
      if (activeSession) {
        this.activeReminderSessions.set(reminderId, {
          ...activeSession,
          reminder,
          payload
        });
      }
      for (const windowItem of windows) {
        if (windowItem.isDestroyed() || windowItem.webContents.isDestroyed()) {
          continue;
        }
        this.options.reminderPayloads.set(windowItem.webContents.id, payload);
        this.options.sendWindowMessage(windowItem, 'reminder-payload:updated', payload);
        windowItem.setTitle(reminder.name);
      }
    }
  }

  hasVisibleWindow() {
    for (const windows of this.reminderWindows.values()) {
      if (windows.some((windowItem) => !windowItem.isDestroyed() && windowItem.isVisible())) {
        return true;
      }
    }
    return false;
  }

  hasOpenWindow(reminderId: string) {
    const windows = this.reminderWindows.get(reminderId) || [];
    return windows.some((windowItem) => !windowItem.isDestroyed());
  }

  closeAllForQuit() {
    this.clearAllRepeatTimers();
    this.clearAllDisplaySleepTimers();

    for (const windows of this.reminderWindows.values()) {
      for (const windowItem of windows) {
        if (!windowItem.isDestroyed()) {
          windowItem.close();
        }
      }
    }

    this.reminderWindows.clear();
    this.options.reminderPayloads.clear();
    this.activeReminderSessions.clear();
    this.stopWindowReassertTimer();
    this.options.reminderActionSession.clear();
    this.updateEscapeShortcut();
  }

  broadcastOverlayVisibility() {
    const menuPanelWindow = this.options.getMenuPanelWindow();
    if (!menuPanelWindow || menuPanelWindow.isDestroyed()) {
      return;
    }
    this.options.sendWindowMessage(menuPanelWindow, 'reminder-overlay:visibility-changed', this.hasVisibleWindow());
  }

  private createWindowForDisplay(reminder: Reminder, display: DisplayInfo, payload: ReminderPayload) {
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
        preload: join(this.options.dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    // 亮屏或解锁后系统可能重排窗口层级；提醒窗口需要压在普通应用之上，但不能盖住截图框选等系统级浮层。
    reminderWindow.setAlwaysOnTop(true, REMINDER_WINDOW_TOP_LEVEL);
    const reminderWebContentsId = reminderWindow.webContents.id;
    this.options.reminderPayloads.set(reminderWebContentsId, payload);
    reminderWindow.once('ready-to-show', () => {
      if (reminderWindow.isDestroyed()) {
        return;
      }
      this.showOverlayWindow(reminderWindow, { focus: true });
      this.broadcastOverlayVisibility();
    });
    reminderWindow.on('closed', () => {
      // closed 触发时 BrowserWindow 的原生对象已经销毁，不能再访问 webContents。
      this.options.reminderPayloads.delete(reminderWebContentsId);
      this.forgetClosedWindow(reminder.id, reminderWindow);
      this.broadcastOverlayVisibility();
    });
    void this.options.loadRenderer(reminderWindow, 'reminder')
      .then(() => {
        // 透明浮层可能不触发 ready-to-show，加载完成后兜底展示，避免提醒静默丢失。
        if (!reminderWindow.isDestroyed() && !reminderWindow.isVisible()) {
          this.showOverlayWindow(reminderWindow, { focus: true });
          this.broadcastOverlayVisibility();
        }
      })
      .catch((error: unknown) => {
        console.error('提醒浮层加载失败', error);
      });

    return reminderWindow;
  }

  private showOverlayWindow(windowItem: BrowserWindow, options: { focus: boolean }) {
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

  private startWindowReassertTimer() {
    if (this.reminderWindowReassertTimer) {
      return;
    }

    // 系统只熄显示器时不一定有 resume/unlock 事件，活动提醒需要自己兜底补回窗口层级。
    this.reminderWindowReassertTimer = setInterval(() => {
      this.reassertActiveWindows();
    }, REMINDER_WINDOW_REASSERT_INTERVAL_MS);
  }

  private stopWindowReassertTimer() {
    if (!this.reminderWindowReassertTimer) {
      return;
    }

    clearInterval(this.reminderWindowReassertTimer);
    this.reminderWindowReassertTimer = null;
  }

  private forgetClosedWindow(reminderId: string, closedWindow: BrowserWindow) {
    const windows = this.reminderWindows.get(reminderId);
    if (!windows) {
      return;
    }

    const remainingWindows = windows.filter((windowItem) => windowItem !== closedWindow && !windowItem.isDestroyed());
    if (remainingWindows.length === 0) {
      this.reminderWindows.delete(reminderId);
      this.updateEscapeShortcut();
      return;
    }

    this.reminderWindows.set(reminderId, remainingWindows);
    this.updateEscapeShortcut();
  }

  private updateEscapeShortcut() {
    const shouldRegister = this.reminderWindows.size > 0;
    if (shouldRegister && !this.reminderEscapeShortcutRegistered) {
      this.reminderEscapeShortcutRegistered = globalShortcut.register(REMINDER_ESCAPE_SHORTCUT, () => {
        void this.dismissOpenRemindersFromShortcut();
      });
      if (!this.reminderEscapeShortcutRegistered) {
        console.warn('注册提醒 Esc 快捷键失败');
      }
      return;
    }

    if (!shouldRegister && this.reminderEscapeShortcutRegistered) {
      globalShortcut.unregister(REMINDER_ESCAPE_SHORTCUT);
      this.reminderEscapeShortcutRegistered = false;
    }
  }

  private async dismissOpenRemindersFromShortcut() {
    const reminderIds = Array.from(this.reminderWindows.keys());
    for (const reminderId of reminderIds) {
      await this.dismissById(reminderId);
    }
  }

  private clearAllDisplaySleepTimers() {
    for (const timer of this.displaySleepTimers.values()) {
      clearTimeout(timer);
    }
    this.displaySleepTimers.clear();
  }

  private clearAllRepeatTimers() {
    for (const timer of this.reminderRepeatTimers.values()) {
      clearInterval(timer);
    }
    this.reminderRepeatTimers.clear();
  }

  private async sleepDisplays() {
    if (process.platform === 'darwin') {
      await this.runSystemCommand('/usr/bin/pmset', ['displaysleepnow'], '自动熄屏失败');
      return;
    }

    if (process.platform === 'win32') {
      // Windows 没有稳定的独立命令行入口，借助系统自带 PowerShell 调用 user32 关闭显示器。
      await this.runSystemCommand('powershell.exe', [
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

  private runSystemCommand(command: string, args: string[], errorMessage: string) {
    return new Promise<void>((resolve) => {
      execFile(command, args, (error) => {
        if (error) {
          console.warn(errorMessage, error);
        }
        resolve();
      });
    });
  }
}
