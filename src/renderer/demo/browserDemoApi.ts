import type {
  AppAboutInfo,
  AppFeatureFlags,
  AppSettings,
  ExternalEventListResult,
  MenuFloatingSurfaceKind,
  Reminder,
  ReminderApi,
  ReminderMessage,
  ReminderPayload,
  ReminderPreviewDetail,
  SyncResult,
  ThemeMode
} from '../../shared/types';
import {
  createDemoReminderPayload,
  createDemoReminders,
  createDemoExternalEvents,
  demoAppSettings,
  demoDefaultMessages,
  demoDisplay
} from './demoData';

type Listener<T> = (value: T) => void;

function noopUnsubscribe() {
  return () => undefined;
}

function createDemoApi(): ReminderApi {
  let reminders = createDemoReminders();
  let defaultMessages = demoDefaultMessages.map((message) => ({ ...message }));
  let settings: AppSettings = {
    ...demoAppSettings,
    themeMode: getThemeModeFromUrl()
  };
  let reminderPayload: ReminderPayload = createDemoReminderPayload();
  const drafts = new Map<string, Reminder>();
  const reminderListeners = new Set<Listener<Reminder[]>>();
  const draftListeners = new Set<(id: string, reminder: Reminder | null) => void>();
  const defaultMessageListeners = new Set<Listener<ReminderMessage[]>>();
  const settingsListeners = new Set<Listener<AppSettings>>();
  const payloadListeners = new Set<Listener<ReminderPayload>>();

  function emitReminders() {
    const nextReminders = reminders.map(cloneReminder);
    reminderListeners.forEach((listener) => listener(nextReminders));
  }

  function emitSettings() {
    settingsListeners.forEach((listener) => listener({ ...settings }));
  }

  function emitDefaultMessages() {
    defaultMessageListeners.forEach((listener) => listener(defaultMessages.map((message) => ({ ...message }))));
  }

  function emitDraft(id: string, reminder: Reminder | null) {
    draftListeners.forEach((listener) => listener(id, reminder ? cloneReminder(reminder) : null));
  }

  return {
    async getReminders() {
      return reminders.map(cloneReminder);
    },
    async saveReminder(reminder) {
      const saved = cloneReminder(reminder);
      const existingIndex = reminders.findIndex((item) => item.id === saved.id);
      if (existingIndex >= 0) {
        reminders[existingIndex] = saved;
      } else {
        reminders = [saved, ...reminders];
      }
      emitReminders();
      return cloneReminder(saved);
    },
    async getDraftReminder(id) {
      const draft = drafts.get(id);
      return draft ? cloneReminder(draft) : null;
    },
    async saveDraftReminder(reminder) {
      const draft = cloneReminder(reminder);
      drafts.set(draft.id, draft);
      emitDraft(draft.id, draft);
      return cloneReminder(draft);
    },
    async deleteDraftReminder(id) {
      drafts.delete(id);
      emitDraft(id, null);
    },
    async deleteReminder(id) {
      reminders = reminders.filter((reminder) => reminder.id !== id);
      emitReminders();
    },
    async toggleReminder(id, enabled) {
      reminders = reminders.map((reminder) => (reminder.id === id ? { ...reminder, enabled } : reminder));
      emitReminders();
    },
    async getDisplays() {
      return [{ ...demoDisplay, bounds: { ...demoDisplay.bounds } }];
    },
    async triggerReminderNow(id) {
      reminderPayload = createDemoReminderPayload();
      reminderPayload.reminderId = id;
      payloadListeners.forEach((listener) => listener(reminderPayload));
    },
    async triggerReminderPreview(id) {
      const reminder = reminders.find((item) => item.id === id);
      if (!reminder) {
        return null;
      }
      reminderPayload = {
        reminderId: `${id}:preview`,
        title: reminder.name,
        message: reminder.messages.find((message) => message.enabled)?.text || reminder.name,
        currentTime: createDemoReminderPayload().currentTime
      };
      payloadListeners.forEach((listener) => listener(reminderPayload));
      const detail: ReminderPreviewDetail = {
        payload: reminderPayload,
        displays: [{ ...demoDisplay, bounds: { ...demoDisplay.bounds } }]
      };
      return detail;
    },
    async snoozeReminder() {},
    async dismissReminder() {},
    async enterReminder() {},
    async listExternalEvents(): Promise<ExternalEventListResult> {
      return {
        events: createDemoExternalEvents(),
        access: [
          { kind: 'calendar', status: 'authorized', granted: true },
          { kind: 'reminders', status: 'authorized', granted: true }
        ],
        message: '已读取 demo 本机日程和提醒事项'
      };
    },
    async linkExternalEvent() {},
    async syncExternalSources(): Promise<SyncResult> {
      return { ok: true, syncedCount: 0, message: '演示模式不需要同步' };
    },
    async getDefaultMessages() {
      return defaultMessages.map((message) => ({ ...message }));
    },
    async saveDefaultMessages(messages) {
      defaultMessages = messages.map((message) => ({ ...message }));
      emitDefaultMessages();
      return defaultMessages.map((message) => ({ ...message }));
    },
    async resetDefaultMessages() {
      defaultMessages = demoDefaultMessages.map((message) => ({ ...message }));
      emitDefaultMessages();
      return defaultMessages.map((message) => ({ ...message }));
    },
    async getAutoLaunch() {
      return false;
    },
    async setAutoLaunch() {
      return false;
    },
    async getAppSettings() {
      return { ...settings };
    },
    async setLockScreenAfterIdle(enabled) {
      settings = { ...settings, lockScreenAfterIdle: enabled };
      emitSettings();
      return { ...settings };
    },
    async setSelectedDisplayIds(displayIds) {
      settings = { ...settings, selectedDisplayIds: displayIds.length ? displayIds : [demoDisplay.id] };
      emitSettings();
      return { ...settings };
    },
    async setThemeMode(themeMode) {
      settings = { ...settings, themeMode };
      document.documentElement.dataset.demoTheme = themeMode;
      emitSettings();
      return { ...settings };
    },
    async getAppFeatureFlags(): Promise<AppFeatureFlags> {
      return { externalSources: true };
    },
    async getAppAboutInfo(): Promise<AppAboutInfo> {
      return { version: '0.1.0', currentYear: new Date().getFullYear() };
    },
    async openExternalLink() {},
    async hideMenuPanel() {},
    async keepMenuPanelOpen() {},
    async openMenuFloatingSurface(request) {
      const params = new URLSearchParams();
      if (request.reminderId) {
        params.set('reminderId', request.reminderId);
      }
      window.location.hash = `#/floating/${request.kind}${params.toString() ? `?${params}` : ''}`;
    },
    async closeMenuFloatingSurface(kind?: MenuFloatingSurfaceKind) {
      if (!kind || window.location.hash.includes(`/floating/${kind}`)) {
        window.location.hash = '';
      }
    },
    async requestReminderDelete(id) {
      reminders = reminders.filter((reminder) => reminder.id !== id);
      emitReminders();
    },
    async quitApp() {},
    async hideAppToBackground() {},
    async getReminderPayload() {
      return reminderPayload;
    },
    async setReminderOverlayMouseThrough() {},
    onRemindersUpdated(callback) {
      reminderListeners.add(callback);
      return () => reminderListeners.delete(callback);
    },
    onDraftReminderUpdated(callback) {
      draftListeners.add(callback);
      return () => draftListeners.delete(callback);
    },
    onDefaultMessagesUpdated(callback) {
      defaultMessageListeners.add(callback);
      return () => defaultMessageListeners.delete(callback);
    },
    onAppSettingsUpdated(callback) {
      settingsListeners.add(callback);
      return () => settingsListeners.delete(callback);
    },
    onReminderPayloadUpdated(callback) {
      payloadListeners.add(callback);
      return () => payloadListeners.delete(callback);
    },
    onMenuPanelWillHide: noopUnsubscribe,
    onMenuPanelBeforeHide: noopUnsubscribe,
    onMenuPanelDidShow: noopUnsubscribe,
    onMenuPanelOpenSettings: noopUnsubscribe,
    onMenuFloatingSurfaceClosed: noopUnsubscribe,
    onReminderDeleteRequested: noopUnsubscribe,
    onReminderOverlayVisibilityChanged: noopUnsubscribe
  };
}

function getThemeModeFromUrl(): ThemeMode {
  const mode = new URLSearchParams(window.location.search).get('theme');
  return mode === 'dark' || mode === 'light' ? mode : demoAppSettings.themeMode;
}

function cloneReminder(reminder: Reminder): Reminder {
  return {
    ...reminder,
    weeklyDays: reminder.weeklyDays ? [...reminder.weeklyDays] : undefined,
    alternateWeekDays: reminder.alternateWeekDays ? [...reminder.alternateWeekDays] : undefined,
    alternateNextWeekDays: reminder.alternateNextWeekDays ? [...reminder.alternateNextWeekDays] : undefined,
    messages: reminder.messages.map((message) => ({ ...message })),
    selectedDisplayIds: [...reminder.selectedDisplayIds],
    linkedExternalSource: reminder.linkedExternalSource ? { ...reminder.linkedExternalSource } : undefined
  };
}

export function installBrowserDemoApi() {
  if (window.xiabanla) {
    return;
  }

  const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  const demoRequested = Boolean(viteEnv?.DEV) || new URLSearchParams(window.location.search).has('demo');
  if (!demoRequested) {
    return;
  }

  // 仅给浏览器预览和发布截图使用；真实 Electron 环境必须继续依赖 preload 暴露的接口。
  window.xiabanla = createDemoApi();
}
