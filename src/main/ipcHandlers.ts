import electron from 'electron/main';
import electronCommon from 'electron/common';
import { createExternalReminderPatch } from '../shared/externalReminder.js';
import { createReminderPayload } from '../shared/reminderPayload.js';
import type {
  DisplayInfo,
  MenuFloatingSurfaceKind,
  MenuFloatingSurfaceRequest,
  Reminder,
  ReminderPayload,
  SyncResult,
  ThemeMode
} from '../shared/types.js';
import { getDisplayInfos } from './displays.js';
import { isExternalSourcesSupported, listExternalEvents } from './externalSources.js';
import type { ReminderActionSession } from './reminderActionSession.js';
import type { ReminderScheduler } from './scheduler.js';
import type { ReminderStore } from './store.js';

const { app, BrowserWindow, ipcMain } = electron;
const { shell } = electronCommon;
type BrowserWindow = Electron.BrowserWindow;
const REMINDER_PREVIEW_TEXT = '这是提醒预览';
const ALLOWED_EXTERNAL_LINKS = new Set([
  'https://www.xiaohongshu.com/user/profile/5bed9e4201e65d00013a32bf',
  'mailto:chase_li@qq.com'
]);

type ReminderWindowOptions = {
  displays?: DisplayInfo[];
  payload?: ReminderPayload;
};

type RegisterIpcHandlersDeps = {
  store: ReminderStore;
  scheduler: ReminderScheduler;
  draftReminders: Map<string, Reminder>;
  reminderPayloads: Map<number, ReminderPayload>;
  reminderActionSession: ReminderActionSession;
  getMenuPanelWindow: () => BrowserWindow | null;
  selectDisplays: () => DisplayInfo[];
  showReminderWindows: (reminder: Reminder, options?: ReminderWindowOptions) => Promise<void>;
  dismissReminderWindows: (reminderId: string) => void;
  dismissReminderById: (reminderId: string) => Promise<void>;
  showMenuPanel: () => void;
  hideAppToBackground: () => void;
  keepMenuPanelOpenForInternalInteraction: () => void;
  openMenuFloatingSurface: (sender: Electron.WebContents, request: MenuFloatingSurfaceRequest) => Promise<void>;
  closeMenuFloatingWindows: (kind?: MenuFloatingSurfaceKind) => void;
  requestAppQuit: () => void;
  syncExternalSourcesNow: () => Promise<SyncResult>;
  broadcastDefaultMessagesUpdated: () => void;
  broadcastDraftReminderUpdated: (id: string) => void;
  broadcastAppSettingsUpdated: () => void;
  updateOpenReminderPayloads: (reminders: Reminder[]) => void;
  sendWindowMessage: (windowItem: BrowserWindow, channel: string, ...args: unknown[]) => boolean;
};

export function registerIpcHandlers(deps: RegisterIpcHandlersDeps) {
  const {
    store,
    scheduler,
    draftReminders,
    reminderPayloads,
    reminderActionSession,
    getMenuPanelWindow,
    selectDisplays,
    showReminderWindows,
    dismissReminderWindows,
    dismissReminderById,
    showMenuPanel,
    hideAppToBackground,
    keepMenuPanelOpenForInternalInteraction,
    openMenuFloatingSurface,
    closeMenuFloatingWindows,
    requestAppQuit,
    syncExternalSourcesNow,
    broadcastDefaultMessagesUpdated,
    broadcastDraftReminderUpdated,
    broadcastAppSettingsUpdated,
    updateOpenReminderPayloads,
    sendWindowMessage
  } = deps;

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
    return syncExternalSourcesNow();
  }

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
    const payload = process.env.XIABANLA_USER_DATA_DIR
      ? createReminderPayload(previewReminder)
      : createReminderPayload(previewReminder, new Date(), {
        title: REMINDER_PREVIEW_TEXT,
        message: REMINDER_PREVIEW_TEXT
      });

    reminderActionSession.registerPreview(previewReminder.id, reminder.id);
    await showReminderWindows(previewReminder, { displays, payload });
    return {
      payload,
      displays
    };
  });
  ipcMain.handle('reminders:snooze', async (_event, id: string, minutes: number) => {
    dismissReminderWindows(id);
    if (reminderActionSession.consumePreview(id)) {
      return;
    }
    await scheduler.snooze(reminderActionSession.consumeActionId(id), minutes);
  });
  ipcMain.handle('reminders:dismiss', async (_event, id: string) => {
    await dismissReminderById(id);
  });
  ipcMain.handle('reminders:enter', async (_event, id: string) => {
    dismissReminderWindows(id);
    if (reminderActionSession.consumePreview(id)) {
      showMenuPanel();
      return;
    }
    await store.markCompletedOnDismiss(reminderActionSession.consumeActionId(id));
    showMenuPanel();
  });
  ipcMain.handle('external:list', () => listExternalEvents());
  ipcMain.handle('external:link', async (_event, reminderId: string, eventId: string) => {
    if (!isExternalSourcesSupported()) {
      throw new Error('当前系统暂不支持读取本机日程和提醒事项');
    }
    await linkExternalEvent(reminderId, eventId);
  });
  ipcMain.handle('external:sync', () => syncExternalSourcesHandler());
  ipcMain.handle('app:feature-flags:get', () => ({
    externalSources: isExternalSourcesSupported()
  }));
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
  ipcMain.handle('settings:theme-mode:set', async (_event, themeMode: ThemeMode) => {
    const settings = await store.setThemeMode(themeMode);
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
    request.kind === 'external-sync' && !isExternalSourcesSupported()
      ? undefined
      : openMenuFloatingSurface(event.sender, request)
  ));
  ipcMain.handle('menu-floating:close', (_event, kind?: MenuFloatingSurfaceKind) => {
    closeMenuFloatingWindows(kind);
  });
  ipcMain.handle('reminders:request-delete', (_event, id: string) => {
    const menuPanelWindow = getMenuPanelWindow();
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
