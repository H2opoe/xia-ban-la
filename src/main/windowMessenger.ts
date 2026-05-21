import type { BrowserWindow } from 'electron/main';

export function canSendToWindow(windowItem: BrowserWindow) {
  // Electron 的窗口关闭过程中，BrowserWindow 对象和 webContents 的销毁时序不完全同步，发送前必须同时检查。
  return !windowItem.isDestroyed() && !windowItem.webContents.isDestroyed();
}

export function sendWindowMessage(windowItem: BrowserWindow, channel: string, ...args: unknown[]) {
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
