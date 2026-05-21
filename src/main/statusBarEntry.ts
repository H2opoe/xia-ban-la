import electron from 'electron/main';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAppIcon, createTrayIcon, getTrayIconPath } from './icons.js';

const { app, BrowserWindow, nativeTheme, Tray } = electron;
type Tray = Electron.Tray;

const STATUS_BAR_HELPER_NAME = 'status-bar-helper';

export type StatusBarAnchorBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type StatusBarEntryOptions = {
  dirname: string;
  onToggleMenuPanel: () => void;
  onShowMenuPanelWithSettings: () => void;
};

export class StatusBarEntry {
  private tray: Tray | null = null;
  private statusBarHelper: ChildProcess | null = null;
  private helperBoundsPath: string | null = null;
  private isQuitting = false;

  constructor(private readonly options: StatusBarEntryOptions) {}

  register() {
    if (process.platform === 'darwin' && this.startStatusBarHelper()) {
      return;
    }

    this.createTray();
  }

  registerThemeIconUpdates() {
    nativeTheme.on('updated', () => this.applyRuntimeIcons());
  }

  applyRuntimeIcons() {
    const icon = createAppIcon();
    if (!icon.isEmpty()) {
      for (const windowItem of BrowserWindow.getAllWindows()) {
        windowItem.setIcon(icon);
      }
      if (process.platform === 'darwin') {
        app.dock?.setIcon(icon);
      }
    }

    if (this.tray) {
      this.tray.setImage(createTrayIcon());
    }
  }

  getAnchorBounds(): StatusBarAnchorBounds | null {
    const trayBounds = this.tray?.getBounds();
    if (trayBounds && trayBounds.width > 0 && trayBounds.height > 0) {
      return trayBounds;
    }

    return this.readHelperBounds();
  }

  async waitForAnchorBounds(timeoutMs = 300) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const bounds = this.getAnchorBounds();
      if (bounds) {
        return bounds;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return this.getAnchorBounds();
  }

  setQuitting(isQuitting: boolean) {
    this.isQuitting = isQuitting;
  }

  cleanup() {
    this.destroyTray();
    this.stopStatusBarHelper();
  }

  private startStatusBarHelper() {
    const helperPath = this.getNativeHelperPath(STATUS_BAR_HELPER_NAME);
    if (!existsSync(helperPath)) {
      return false;
    }

    this.helperBoundsPath = join(app.getPath('userData'), 'status-bar-bounds.json');
    this.statusBarHelper = spawn(helperPath, [
      '--pid',
      String(process.pid),
      '--icon',
      getTrayIconPath(),
      '--bounds-file',
      this.helperBoundsPath
    ], {
      stdio: 'ignore'
    });
    this.statusBarHelper.once('exit', () => {
      this.statusBarHelper = null;
    });
    this.statusBarHelper.once('error', () => {
      this.statusBarHelper = null;
      if (!this.isQuitting && !this.tray) {
        this.createTray();
      }
    });
    return true;
  }

  private stopStatusBarHelper() {
    if (!this.statusBarHelper || this.statusBarHelper.killed) {
      return;
    }

    this.statusBarHelper.kill();
    this.statusBarHelper = null;
  }

  private destroyTray() {
    if (!this.tray) {
      return;
    }

    this.tray.removeAllListeners();
    this.tray.destroy();
    this.tray = null;
  }

  private getNativeHelperPath(helperName: string) {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'native', helperName);
    }

    return join(this.options.dirname, '..', 'native', helperName);
  }

  private readHelperBounds() {
    if (!this.helperBoundsPath || !existsSync(this.helperBoundsPath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.helperBoundsPath, 'utf8')) as Partial<StatusBarAnchorBounds>;
      if (
        typeof parsed.x === 'number'
        && typeof parsed.y === 'number'
        && typeof parsed.width === 'number'
        && typeof parsed.height === 'number'
        && parsed.width > 0
        && parsed.height > 0
      ) {
        return {
          x: parsed.x,
          y: parsed.y,
          width: parsed.width,
          height: parsed.height
        };
      }
    } catch (error) {
      console.warn('读取菜单栏图标位置失败', error);
    }

    return null;
  }

  private createTray() {
    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip('下班啦');
    if (process.platform === 'darwin') {
      // 菜单栏空间有限，入口使用固定 18px 模板图标；中文名称保留在 tooltip，避免长标题被系统挤出状态栏。
      this.tray.setTitle('');
      app.dock?.hide();
    }
    this.tray.on('click', this.options.onToggleMenuPanel);
    this.tray.on('right-click', this.options.onShowMenuPanelWithSettings);
  }
}
