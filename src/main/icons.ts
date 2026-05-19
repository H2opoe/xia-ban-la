import { app, nativeImage, nativeTheme } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIGHT_APP_ICON_FILE = 'icon.png';
const DARK_APP_ICON_FILE = 'icon-dark.png';
const TRAY_ICON_FILE = 'tray.svg';

export function createTrayIcon() {
  const icon = createIconFromSvgFile(getRuntimeBuildIconPath(TRAY_ICON_FILE));
  if (!icon.isEmpty()) {
    const size = process.platform === 'darwin' ? 18 : 32;
    const trayIcon = icon.resize({ width: size, height: size });
    if (process.platform === 'darwin') {
      // macOS 菜单栏会随浅色/深色外观切换颜色，模板图标才能避免白色 SVG 在浅色菜单栏里“隐身”。
      trayIcon.setTemplateImage(true);
    }
    return trayIcon;
  }

  if (process.platform === 'darwin') {
    const fallbackIcon = nativeImage.createFromNamedImage('NSActionTemplate');
    if (!fallbackIcon.isEmpty()) {
      fallbackIcon.setTemplateImage(true);
      return fallbackIcon;
    }
  }

  return createAppIcon();
}

export function getTrayIconPath() {
  return getRuntimeBuildIconPath(TRAY_ICON_FILE);
}

export function createAppIcon() {
  const icon = nativeImage.createFromPath(getRuntimeBuildIconPath(getThemeAppIconFile()));
  if (!icon.isEmpty()) {
    return icon;
  }

  return nativeImage.createFromPath(getRuntimeBuildIconPath(LIGHT_APP_ICON_FILE));
}

function getThemeAppIconFile() {
  return nativeTheme.shouldUseDarkColors ? DARK_APP_ICON_FILE : LIGHT_APP_ICON_FILE;
}

function createIconFromSvgFile(filePath: string) {
  if (!existsSync(filePath)) {
    return nativeImage.createEmpty();
  }

  const svg = readFileSync(filePath, 'utf8');
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function getRuntimeBuildIconPath(fileName: string) {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icons', fileName);
  }

  return join(__dirname, '..', '..', 'build', fileName);
}
