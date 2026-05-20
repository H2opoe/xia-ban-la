import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, MenuFloatingSurfaceKind, Reminder, ReminderApi, ReminderMessage, ReminderPayload } from '../shared/types.js';

const api: ReminderApi = {
  getReminders: () => ipcRenderer.invoke('reminders:get'),
  saveReminder: (reminder) => ipcRenderer.invoke('reminders:save', reminder),
  getDraftReminder: (id) => ipcRenderer.invoke('reminders:draft:get', id),
  saveDraftReminder: (reminder) => ipcRenderer.invoke('reminders:draft:save', reminder),
  deleteDraftReminder: (id) => ipcRenderer.invoke('reminders:draft:delete', id),
  deleteReminder: (id) => ipcRenderer.invoke('reminders:delete', id),
  toggleReminder: (id, enabled) => ipcRenderer.invoke('reminders:toggle', id, enabled),
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  triggerReminderNow: (id) => ipcRenderer.invoke('reminders:trigger-now', id),
  triggerReminderPreview: (id) => ipcRenderer.invoke('reminders:trigger-preview', id),
  snoozeReminder: (id, minutes) => ipcRenderer.invoke('reminders:snooze', id, minutes),
  dismissReminder: (id) => ipcRenderer.invoke('reminders:dismiss', id),
  enterReminder: (id) => ipcRenderer.invoke('reminders:enter', id),
  listExternalEvents: () => ipcRenderer.invoke('external:list'),
  linkExternalEvent: (reminderId, eventId) => ipcRenderer.invoke('external:link', reminderId, eventId),
  syncExternalSources: () => ipcRenderer.invoke('external:sync'),
  getDefaultMessages: () => ipcRenderer.invoke('settings:default-messages:get'),
  saveDefaultMessages: (messages) => ipcRenderer.invoke('settings:default-messages:save', messages),
  resetDefaultMessages: () => ipcRenderer.invoke('settings:default-messages:reset'),
  getAutoLaunch: () => ipcRenderer.invoke('settings:auto-launch:get'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:auto-launch:set', enabled),
  getAppSettings: () => ipcRenderer.invoke('settings:app:get'),
  setLockScreenAfterIdle: (enabled) => ipcRenderer.invoke('settings:lock-screen-after-idle:set', enabled),
  setSelectedDisplayIds: (displayIds) => ipcRenderer.invoke('settings:selected-display-ids:set', displayIds),
  setThemeMode: (themeMode) => ipcRenderer.invoke('settings:theme-mode:set', themeMode),
  getAppFeatureFlags: () => ipcRenderer.invoke('app:feature-flags:get'),
  getAppAboutInfo: () => ipcRenderer.invoke('app:about-info'),
  openExternalLink: (url) => ipcRenderer.invoke('app:open-external-link', url),
  hideMenuPanel: () => ipcRenderer.invoke('menu-panel:hide'),
  keepMenuPanelOpen: () => ipcRenderer.invoke('menu-panel:keep-open'),
  openMenuFloatingSurface: (request) => ipcRenderer.invoke('menu-floating:open', request),
  closeMenuFloatingSurface: (kind) => ipcRenderer.invoke('menu-floating:close', kind),
  requestReminderDelete: (id) => ipcRenderer.invoke('reminders:request-delete', id),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  hideAppToBackground: () => ipcRenderer.invoke('app:hide-to-background'),
  getReminderPayload: () => ipcRenderer.invoke('reminder-payload:get'),
  setReminderOverlayMouseThrough: (enabled) => ipcRenderer.invoke('reminder-overlay:mouse-through:set', enabled),
  onRemindersUpdated: (callback: (reminders: Reminder[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, reminders: Reminder[]) => callback(reminders);
    ipcRenderer.on('reminders:updated', handler);
    return () => ipcRenderer.off('reminders:updated', handler);
  },
  onDraftReminderUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string, reminder: Reminder | null) => callback(id, reminder);
    ipcRenderer.on('reminders:draft-updated', handler);
    return () => ipcRenderer.off('reminders:draft-updated', handler);
  },
  onDefaultMessagesUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, messages: ReminderMessage[]) => callback(messages);
    ipcRenderer.on('default-messages:updated', handler);
    return () => ipcRenderer.off('default-messages:updated', handler);
  },
  onAppSettingsUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on('app-settings:updated', handler);
    return () => ipcRenderer.off('app-settings:updated', handler);
  },
  onReminderPayloadUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ReminderPayload) => callback(payload);
    ipcRenderer.on('reminder-payload:updated', handler);
    return () => ipcRenderer.off('reminder-payload:updated', handler);
  },
  onMenuPanelWillHide: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-panel:will-hide', handler);
    return () => ipcRenderer.off('menu-panel:will-hide', handler);
  },
  onMenuPanelBeforeHide: (callback) => {
    const handler = async (_event: Electron.IpcRendererEvent, requestId: string) => {
      let canHide = true;
      try {
        canHide = await callback();
      } catch (error) {
        console.error('隐藏菜单面板前保存编辑失败', error);
        canHide = false;
      }
      ipcRenderer.send(`menu-panel:before-hide-result:${requestId}`, canHide);
    };
    ipcRenderer.on('menu-panel:before-hide', handler);
    return () => ipcRenderer.off('menu-panel:before-hide', handler);
  },
  onMenuPanelDidShow: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-panel:did-show', handler);
    return () => ipcRenderer.off('menu-panel:did-show', handler);
  },
  onMenuPanelOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('menu-panel:open-settings', handler);
    return () => ipcRenderer.off('menu-panel:open-settings', handler);
  },
  onMenuFloatingSurfaceClosed: (callback: (kind: MenuFloatingSurfaceKind) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, kind: MenuFloatingSurfaceKind) => callback(kind);
    ipcRenderer.on('menu-floating:closed', handler);
    return () => ipcRenderer.off('menu-floating:closed', handler);
  },
  onReminderDeleteRequested: (callback: (id: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('reminders:delete-requested', handler);
    return () => ipcRenderer.off('reminders:delete-requested', handler);
  },
  onReminderOverlayVisibilityChanged: (callback: (visible: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible);
    ipcRenderer.on('reminder-overlay:visibility-changed', handler);
    return () => ipcRenderer.off('reminder-overlay:visibility-changed', handler);
  }
};

contextBridge.exposeInMainWorld('xiabanla', api);
