export type RepeatRule = 'once' | 'daily' | 'weekdays' | 'weekly' | 'alternate-weeks';
export type ThemeMode = 'system' | 'light' | 'dark';

export type ExternalProvider = 'macos-calendar' | 'macos-reminders' | 'windows-calendar';

export type ReminderMessage = {
  id: string;
  text: string;
  enabled: boolean;
};

export type LinkedExternalSource = {
  provider: ExternalProvider;
  externalId: string;
  seriesId?: string;
  title: string;
  lastSyncedAt?: string;
  syncStatus?: 'ok' | 'error' | 'deleted' | 'unsupported';
  syncError?: string;
};

export type Reminder = {
  id: string;
  name: string;
  createdAt?: string;
  enabled: boolean;
  completed?: boolean;
  completedAt?: string;
  repeatRule: RepeatRule;
  weeklyDays?: number[];
  useAlternateWeeks?: boolean;
  alternateWeekAnchorDate?: string;
  alternateWeekDays?: number[];
  alternateNextWeekDays?: number[];
  scheduledDate: string;
  dailyTime: string;
  advanceMinutes: number;
  todayOverrideTime?: string;
  todayOverrideDate?: string;
  repeatUntilDismissed: boolean;
  repeatIntervalMinutes: number;
  messages: ReminderMessage[];
  selectedDisplayIds: string[];
  linkedExternalSource?: LinkedExternalSource;
};

export type AppSettings = {
  lockScreenAfterIdle: boolean;
  selectedDisplayIds: string[];
};

export type DisplayInfo = {
  id: string;
  label: string;
  isPrimary: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type ExternalEvent = {
  id: string;
  seriesId?: string;
  provider: ExternalProvider;
  title: string;
  startTime: string;
  completed?: boolean;
};

export type ExternalAccessKind = 'calendar' | 'reminders';

export type ExternalAccessStatus =
  | 'authorized'
  | 'full-access'
  | 'write-only'
  | 'not-determined'
  | 'denied'
  | 'restricted'
  | 'unsupported'
  | 'error';

export type ExternalSourceAccess = {
  kind: ExternalAccessKind;
  status: ExternalAccessStatus;
  granted: boolean;
  message?: string;
};

export type ExternalEventListResult = {
  events: ExternalEvent[];
  access: ExternalSourceAccess[];
  message: string;
};

export type SyncResult = {
  ok: boolean;
  syncedCount: number;
  message: string;
};

export type AppAboutInfo = {
  version: string;
  currentYear: number;
};

export type ReminderPayload = {
  reminderId: string;
  title: string;
  message: string;
  currentTime: string;
};

export type ReminderPreviewDetail = {
  payload: ReminderPayload;
  displays: DisplayInfo[];
};

export type MenuFloatingSurfaceKind =
  | 'settings'
  | 'settings-display'
  | 'settings-lock-screen'
  | 'settings-theme'
  | 'settings-about'
  | 'external-sync'
  | 'reminder-context'
  | 'title-warning'
  | 'reminder-date'
  | 'reminder-repeat'
  | 'today-override'
  | 'default-messages';

export type MenuFloatingSurfaceAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MenuFloatingSurfaceRequest = {
  kind: MenuFloatingSurfaceKind;
  anchorRect: MenuFloatingSurfaceAnchor;
  reminderId?: string;
  restoreTitle?: string;
  placement?: 'bottom-left' | 'bottom-right' | 'right-top' | 'left-top';
  preferredWidth?: number;
  preferredHeight?: number;
};

export type ReminderApi = {
  getReminders(): Promise<Reminder[]>;
  saveReminder(reminder: Reminder): Promise<Reminder>;
  getDraftReminder(id: string): Promise<Reminder | null>;
  saveDraftReminder(reminder: Reminder): Promise<Reminder>;
  deleteDraftReminder(id: string): Promise<void>;
  deleteReminder(id: string): Promise<void>;
  toggleReminder(id: string, enabled: boolean): Promise<void>;
  getDisplays(): Promise<DisplayInfo[]>;
  triggerReminderNow(id: string): Promise<void>;
  triggerReminderPreview(id: string): Promise<ReminderPreviewDetail | null>;
  snoozeReminder(id: string, minutes: number): Promise<void>;
  dismissReminder(id: string): Promise<void>;
  enterReminder(id: string): Promise<void>;
  listExternalEvents(): Promise<ExternalEventListResult>;
  linkExternalEvent(reminderId: string, eventId: string): Promise<void>;
  syncExternalSources(): Promise<SyncResult>;
  getDefaultMessages(): Promise<ReminderMessage[]>;
  saveDefaultMessages(messages: ReminderMessage[]): Promise<ReminderMessage[]>;
  resetDefaultMessages(): Promise<ReminderMessage[]>;
  getAutoLaunch(): Promise<boolean>;
  setAutoLaunch(enabled: boolean): Promise<boolean>;
  getAppSettings(): Promise<AppSettings>;
  setLockScreenAfterIdle(enabled: boolean): Promise<AppSettings>;
  setSelectedDisplayIds(displayIds: string[]): Promise<AppSettings>;
  getAppAboutInfo(): Promise<AppAboutInfo>;
  openExternalLink(url: string): Promise<void>;
  hideMenuPanel(): Promise<void>;
  keepMenuPanelOpen(): Promise<void>;
  openMenuFloatingSurface(request: MenuFloatingSurfaceRequest): Promise<void>;
  closeMenuFloatingSurface(kind?: MenuFloatingSurfaceKind): Promise<void>;
  requestReminderDelete(id: string): Promise<void>;
  quitApp(): Promise<void>;
  hideAppToBackground(): Promise<void>;
  getReminderPayload(): Promise<ReminderPayload | null>;
  setReminderOverlayMouseThrough(enabled: boolean): Promise<void>;
  onRemindersUpdated(callback: (reminders: Reminder[]) => void): () => void;
  onDraftReminderUpdated(callback: (id: string, reminder: Reminder | null) => void): () => void;
  onDefaultMessagesUpdated(callback: (messages: ReminderMessage[]) => void): () => void;
  onAppSettingsUpdated(callback: (settings: AppSettings) => void): () => void;
  onReminderPayloadUpdated(callback: (payload: ReminderPayload) => void): () => void;
  onMenuPanelWillHide(callback: () => void): () => void;
  onMenuPanelBeforeHide(callback: () => boolean | Promise<boolean>): () => void;
  onMenuPanelDidShow(callback: () => void): () => void;
  onMenuPanelOpenSettings(callback: () => void): () => void;
  onMenuFloatingSurfaceClosed(callback: (kind: MenuFloatingSurfaceKind) => void): () => void;
  onReminderDeleteRequested(callback: (id: string) => void): () => void;
  onReminderOverlayVisibilityChanged(callback: (visible: boolean) => void): () => void;
};
