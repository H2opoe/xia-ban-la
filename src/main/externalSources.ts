import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  ExternalAccessKind,
  ExternalAccessStatus,
  ExternalEvent,
  ExternalEventListResult,
  ExternalProvider,
  ExternalSourceAccess,
  Reminder,
  SyncResult
} from '../shared/types.js';
import { getExternalAccessInstruction } from '../shared/externalAccessMessages.js';
import { createExternalReminderPatch, getExternalEventLinkKeys, getExternalSourceLinkKeys } from '../shared/externalReminder.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MAC_EVENTKIT_HELPER_NAME = 'eventkit-bridge';
const MAC_EVENTKIT_HELPER_TIMEOUT_MS = 60_000;

export async function listExternalEvents(): Promise<ExternalEventListResult> {
  if (process.platform === 'darwin') {
    return listMacEvents();
  }

  const message = process.platform === 'win32'
    ? '当前 Windows 系统日历接口暂不可用，本地提醒仍可正常使用'
    : '当前系统暂不支持读取本机日程和提醒事项';

  return {
    events: [],
    access: [
      createAccess('calendar', 'unsupported', false, message),
      createAccess('reminders', 'unsupported', false, message)
    ],
    message
  };
}

export async function syncExternalSources(reminders: Reminder[]): Promise<{ reminders: Reminder[]; result: SyncResult }> {
  const listResult = await listExternalEvents();
  const events = listResult.events;
  const eventsByKey = new Map(events.flatMap((event) => getExternalEventLinkKeys(event).map((key) => [key, event])));
  const accessByKind = new Map(listResult.access.map((access) => [access.kind, access]));
  const blockedMessages = new Set<string>();
  let syncedCount = 0;
  let removedCount = 0;

  const nextReminders = reminders.flatMap((reminder): Reminder[] => {
    if (!reminder.linkedExternalSource) {
      return [reminder];
    }

    const access = accessByKind.get(getAccessKindForProvider(reminder.linkedExternalSource.provider));
    if (access && !access.granted) {
      const syncError = access.message || getAccessFallbackMessage(access.kind, access.status);
      blockedMessages.add(syncError);
      return [{
        ...reminder,
        linkedExternalSource: {
          ...reminder.linkedExternalSource,
          syncStatus: access.status === 'unsupported' ? 'unsupported' as const : 'error' as const,
          syncError
        }
      }];
    }

    const event = getExternalSourceLinkKeys(reminder.linkedExternalSource)
      .map((key) => eventsByKey.get(key))
      .find((candidate): candidate is ExternalEvent => Boolean(candidate));
    if (!event && isCalendarProvider(reminder.linkedExternalSource.provider) && isReminderMirrorExpired(reminder)) {
      syncedCount += 1;
      return [{
        ...reminder,
        completed: true,
        completedAt: reminder.completedAt || new Date().toISOString(),
        linkedExternalSource: {
          ...reminder.linkedExternalSource,
          lastSyncedAt: new Date().toISOString(),
          syncStatus: 'ok' as const,
          syncError: undefined
        }
      }];
    }

    if (!event && isRecurringExternalReminder(reminder)) {
      syncedCount += 1;
      return [{
        ...reminder,
        linkedExternalSource: {
          ...reminder.linkedExternalSource,
          lastSyncedAt: new Date().toISOString(),
          syncStatus: 'ok' as const,
          syncError: undefined
        }
      }];
    }

    if (!event) {
      removedCount += 1;
      return [];
    }

    syncedCount += 1;
    const externalPatch = createExternalReminderPatch(event, reminder.linkedExternalSource);
    const isExternalReminder = event.provider === 'macos-reminders';
    const syncedCompleted = isExternalReminder ? Boolean(event.completed) : false;
    const shouldRestoreForNextExternalOccurrence = Boolean(
      reminder.completed
      && !isExternalReminder
      && (
        reminder.linkedExternalSource.externalId !== externalPatch.linkedExternalSource.externalId
        || reminder.scheduledDate !== externalPatch.scheduledDate
        || reminder.dailyTime !== externalPatch.dailyTime
      )
    );
    return [{
      ...reminder,
      ...externalPatch,
      completed: isExternalReminder ? syncedCompleted : (shouldRestoreForNextExternalOccurrence ? false : reminder.completed),
      completedAt: getSyncedCompletedAt(reminder, isExternalReminder, syncedCompleted, shouldRestoreForNextExternalOccurrence),
      linkedExternalSource: {
        ...externalPatch.linkedExternalSource,
        syncStatus: 'ok' as const,
        syncError: undefined
      }
    }];
  });

  const blockedMessageText = Array.from(blockedMessages).join('；');
  const successMessage = getSyncSuccessMessage(syncedCount, removedCount);

  return {
    reminders: nextReminders,
    result: {
      ok: blockedMessages.size === 0,
      syncedCount,
      message: blockedMessageText || successMessage
    }
  };
}

async function listMacEvents(): Promise<ExternalEventListResult> {
  const helperPath = getMacEventKitHelperPath();
  if (!existsSync(helperPath)) {
    return createFailureResult('日程同步助手未构建，请重新运行开发命令或重新打包应用');
  }

  try {
    const { stdout } = await execFileAsync(helperPath, ['list'], {
      timeout: MAC_EVENTKIT_HELPER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    return parseMacEventKitResult(stdout);
  } catch (error) {
    return createFailureResult(getMacEventKitErrorMessage(error));
  }
}

function getMacEventKitHelperPath() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'native', MAC_EVENTKIT_HELPER_NAME);
  }

  return join(__dirname, '..', 'native', MAC_EVENTKIT_HELPER_NAME);
}

function parseMacEventKitResult(stdout: string): ExternalEventListResult {
  try {
    const parsed = JSON.parse(stdout) as Partial<ExternalEventListResult>;
    const events = Array.isArray(parsed.events) ? parsed.events.filter(isExternalEvent) : [];
    const access = normalizeAccessList(parsed.access);
    const blockedAccessMessage = getBlockedAccessMessage(access);
    const message = blockedAccessMessage || (typeof parsed.message === 'string' && parsed.message.trim()
      ? parsed.message.trim()
      : getListMessage(events, access));

    return {
      events,
      access,
      message
    };
  } catch {
    return createFailureResult('读取系统日历和提醒事项失败：日程同步助手返回了无效数据');
  }
}

function normalizeAccessList(accessList: unknown): ExternalSourceAccess[] {
  const accessByKind = new Map<ExternalAccessKind, ExternalSourceAccess>();

  if (Array.isArray(accessList)) {
    for (const item of accessList) {
      if (isExternalSourceAccess(item)) {
        accessByKind.set(item.kind, normalizeAccess(item));
      }
    }
  }

  return [
    accessByKind.get('calendar') || createAccess('calendar', 'error', false),
    accessByKind.get('reminders') || createAccess('reminders', 'error', false)
  ];
}

function createFailureResult(message: string): ExternalEventListResult {
  return {
    events: [],
    access: [
      createAccess('calendar', 'error', false, message),
      createAccess('reminders', 'error', false, message)
    ],
    message
  };
}

function createAccess(
  kind: ExternalAccessKind,
  status: ExternalSourceAccess['status'],
  granted: boolean,
  message?: string
): ExternalSourceAccess {
  return {
    kind,
    status,
    granted,
    message: message ?? (granted ? undefined : getExternalAccessInstruction(kind, status))
  };
}

function normalizeAccess(access: ExternalSourceAccess): ExternalSourceAccess {
  if (access.granted) {
    return {
      ...access,
      message: undefined
    };
  }

  return {
    ...access,
    message: shouldUsePermissionInstruction(access.status)
      ? getExternalAccessInstruction(access.kind, access.status)
      : access.message || getExternalAccessInstruction(access.kind, access.status)
  };
}

function isExternalEvent(event: unknown): event is ExternalEvent {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const candidate = event as ExternalEvent;
  return isExternalProvider(candidate.provider)
    && typeof candidate.id === 'string'
    && candidate.id.length > 0
    && (candidate.seriesId === undefined || typeof candidate.seriesId === 'string')
    && typeof candidate.title === 'string'
    && typeof candidate.startTime === 'string'
    && (candidate.isRecurring === undefined || typeof candidate.isRecurring === 'boolean')
    && !Number.isNaN(new Date(candidate.startTime).getTime());
}

function isExternalSourceAccess(access: unknown): access is ExternalSourceAccess {
  if (!access || typeof access !== 'object') {
    return false;
  }

  const candidate = access as ExternalSourceAccess;
  return (candidate.kind === 'calendar' || candidate.kind === 'reminders')
    && typeof candidate.status === 'string'
    && typeof candidate.granted === 'boolean'
    && (candidate.message === undefined || typeof candidate.message === 'string');
}

function isExternalProvider(provider: unknown): provider is ExternalProvider {
  return provider === 'macos-calendar' || provider === 'macos-reminders' || provider === 'windows-calendar';
}

function getListMessage(events: ExternalEvent[], accessList: ExternalSourceAccess[]) {
  const blockedAccessMessage = getBlockedAccessMessage(accessList);
  if (blockedAccessMessage) {
    return blockedAccessMessage;
  }

  return events.length > 0 ? `读取到 ${events.length} 个外部项目` : '没有读取到可绑定的外部项目';
}

function getBlockedAccessMessage(accessList: ExternalSourceAccess[]) {
  return accessList.find((access) => !access.granted && access.message)?.message;
}

function getAccessKindForProvider(provider: ExternalProvider): ExternalAccessKind {
  if (provider === 'macos-reminders') {
    return 'reminders';
  }

  return 'calendar';
}

function isCalendarProvider(provider: ExternalProvider) {
  return provider === 'macos-calendar' || provider === 'windows-calendar';
}

function isRecurringExternalReminder(reminder: Reminder) {
  return reminder.linkedExternalSource?.provider === 'macos-reminders'
    && reminder.linkedExternalSource.isRecurring === true;
}

function isReminderMirrorExpired(reminder: Reminder, now = new Date()) {
  const [hour = 0, minute = 0] = reminder.dailyTime.split(':').map(Number);
  const dueDate = new Date(`${reminder.scheduledDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
  return !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < now.getTime();
}

function getSyncedCompletedAt(
  reminder: Reminder,
  isExternalReminder: boolean,
  externalCompleted: boolean,
  shouldRestore: boolean
) {
  if (isExternalReminder && externalCompleted) {
    return reminder.completedAt || new Date().toISOString();
  }
  if (isExternalReminder || shouldRestore) {
    return undefined;
  }
  return reminder.completedAt;
}

function getSyncSuccessMessage(syncedCount: number, removedCount: number) {
  if (syncedCount > 0 && removedCount > 0) {
    return `已同步 ${syncedCount} 个外部提醒，已移除 ${removedCount} 个已删除项目`;
  }
  if (syncedCount > 0) {
    return `已同步 ${syncedCount} 个外部提醒`;
  }
  if (removedCount > 0) {
    return `已移除 ${removedCount} 个已删除项目`;
  }
  return '没有需要同步的外部提醒';
}

function getAccessFallbackMessage(kind: ExternalAccessKind, status: ExternalSourceAccess['status']) {
  return getExternalAccessInstruction(kind, status);
}

function shouldUsePermissionInstruction(status: ExternalAccessStatus) {
  return status === 'denied'
    || status === 'restricted'
    || status === 'not-determined'
    || status === 'write-only';
}

function getMacEventKitErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const candidate = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
    if (candidate.killed || candidate.signal === 'SIGTERM' || candidate.code === 'ETIMEDOUT') {
      return '读取系统日历和提醒事项超时。请在系统弹窗中点击“允许”；如果没有看到弹窗，请打开 系统设置 > 隐私与安全性 > 日历 和 提醒事项，允许“下班啦”访问后再重试。';
    }

    if (typeof candidate.stderr === 'string' && candidate.stderr.trim()) {
      return `读取系统日历和提醒事项失败：${candidate.stderr.trim()}`;
    }

    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return `读取系统日历和提醒事项失败：${candidate.message.trim()}`;
    }
  }

  return '读取系统日历和提醒事项失败';
}
