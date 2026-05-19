import type { ExternalAccessKind, ExternalAccessStatus } from './types.js';

const APP_NAME = '下班啦';

export function getExternalAccessInstruction(kind: ExternalAccessKind, status: ExternalAccessStatus) {
  const permissionName = getPermissionName(kind);
  const readableName = getReadableName(kind);
  const settingsPath = getExternalAccessSettingsPath(kind);

  if (status === 'denied' || status === 'restricted') {
    return `未获得${permissionName}访问权限。请打开 ${settingsPath}，允许“${APP_NAME}”访问后再重试。`;
  }

  if (status === 'not-determined') {
    return `尚未完成${permissionName}授权。请在系统弹窗中点击“允许”；如果没有看到弹窗，请打开 ${settingsPath}，允许“${APP_NAME}”访问后再重试。`;
  }

  if (status === 'write-only') {
    return `当前只有日历写入权限，读取日历日程需要完整访问权限。请打开 ${settingsPath}，将“${APP_NAME}”改为完整访问后再重试。`;
  }

  return `无法读取本机${readableName}。请打开 ${settingsPath}，确认“${APP_NAME}”已允许访问后再重试。`;
}

export function getExternalAccessSettingsPath(kind: ExternalAccessKind) {
  return `系统设置 > 隐私与安全性 > ${getPermissionName(kind)}`;
}

function getPermissionName(kind: ExternalAccessKind) {
  return kind === 'calendar' ? '日历' : '提醒事项';
}

function getReadableName(kind: ExternalAccessKind) {
  return kind === 'calendar' ? '日历日程' : '提醒事项';
}
