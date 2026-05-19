import { app, BrowserWindow, nativeTheme, Tray } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAppIcon, createTrayIcon, getTrayIconPath } from './icons.js';

const STATUS_BAR_HELPER_NAME = 'status-bar-helper';

type StatusBarEntryOptions = {
  dirname: string;
  onToggleMenuPanel: () => void;
  onShowMenuPanelWithSettings: () => void;
};

export class StatusBarEntry {
  private tray: Tray | null = null;
  private statusBarHelper: ChildProcess | null = null;
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

  getTray() {
    return this.tray;
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

    this.statusBarHelper = spawn(helperPath, [
      '--pid',
      String(process.pid),
      '--icon',
      getTrayIconPath()
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
