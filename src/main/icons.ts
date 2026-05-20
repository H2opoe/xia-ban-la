import { app, nativeImage, nativeTheme } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIGHT_APP_ICON_FILE = 'icon.png';
const DARK_APP_ICON_FILE = 'icon-dark.png';
const TRAY_ICON_FILE = 'tray.svg';
const FALLBACK_TRAY_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M5 7.5h14.5a3 3 0 0 1 3 3v3.2" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5 7.5h14.5a3 3 0 0 1 3 3v9.8a3 3 0 0 1-3 3H5z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  <path d="M16.5 16h9.2m-3.8-3.8 3.8 3.8-3.8 3.8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export function createTrayIcon() {
  const icon = createIconFromSvgFile(getRuntimeBuildIconPath(TRAY_ICON_FILE));
  const sourceIcon = icon.isEmpty() ? createIconFromSvg(FALLBACK_TRAY_ICON_SVG) : icon;
  if (!sourceIcon.isEmpty()) {
    const size = process.platform === 'darwin' ? 18 : 32;
    const trayIcon = sourceIcon.resize({ width: size, height: size });
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
  return createIconFromSvg(svg);
}

function createIconFromSvg(svg: string) {
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function getRuntimeBuildIconPath(fileName: string) {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icons', fileName);
  }

  return join(__dirname, '..', '..', 'build', fileName);
}
