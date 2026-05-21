import type { BrowserWindow } from 'electron/main';
import { join } from 'node:path';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

export async function loadRenderer(dirname: string, windowItem: BrowserWindow, route = '') {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await windowItem.loadURL(`${process.env.VITE_DEV_SERVER_URL}${route ? `/#/${route}` : ''}`);
    return;
  }

  await windowItem.loadFile(join(dirname, '../../dist/index.html'), {
    hash: route ? `/${route}` : ''
  });
}
