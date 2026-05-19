import React, { useEffect, useState } from 'react';
import type {
  MenuFloatingSurfaceKind,
  MenuFloatingSurfaceRequest,
  ThemeMode
} from '../../../../shared/types';
import { formatSelectedDisplays } from '../../../domain/displaySelection';
import { getSettingsAboutMenuWidth } from '../../../domain/settingsMenuMetrics';
import { loadThemeMode, subscribeThemeMode } from '../../../state/theme';
import {
  clearHoveredFloatingMenuRow,
  closeFloatingSubmenusFromParentPointer,
  useFloatingSubmenu,
  syncHoveredFloatingMenuRow
} from '../floatingSurfaceModel';
import type { SettingsMenuState } from './types';

const SETTINGS_THEME_MENU_WIDTH = 105;

function SettingsPopover(props: {
  state: SettingsMenuState;
  className?: string;
  onAutoLaunchChange: (enabled: boolean) => void;
}) {
  const {
    state,
    className = 'settings-popover',
    onAutoLaunchChange
  } = props;
  const [autoLaunch, setAutoLaunch] = useState(state.autoLaunch);
  const [lockScreenAfterIdle, setLockScreenAfterIdle] = useState(state.lockScreenAfterIdle);
  const [selectedDisplayIds, setSelectedDisplayIds] = useState(state.selectedDisplayIds);
  const [themeMode, setThemeMode] = useState(state.themeMode);
  const { activeNestedKind, openSubmenu, closeSubmenu } = useFloatingSubmenu();

  useEffect(() => {
    setAutoLaunch(state.autoLaunch);
    setLockScreenAfterIdle(state.lockScreenAfterIdle);
    setSelectedDisplayIds(state.selectedDisplayIds);
    setThemeMode(state.themeMode);
  }, [state.autoLaunch, state.lockScreenAfterIdle, state.selectedDisplayIds, state.themeMode]);

  async function toggleAutoLaunch(enabled: boolean) {
    const nextAutoLaunch = await window.xiabanla.setAutoLaunch(enabled);
    setAutoLaunch(nextAutoLaunch);
    onAutoLaunchChange(nextAutoLaunch);
  }

  function getThemeModeLabel(mode: ThemeMode) {
    if (mode === 'light') {
      return '浅色';
    }
    if (mode === 'dark') {
      return '深色';
    }
    return '跟随系统';
  }

  function openSettingsSubmenu(
    kind: MenuFloatingSurfaceKind,
    event: React.SyntheticEvent<HTMLElement>,
    options: Omit<MenuFloatingSurfaceRequest, 'kind' | 'anchorRect'> = {}
  ) {
    if (kind === 'settings-about') {
      openSubmenu(kind, event, {
        ...options,
        preferredWidth: getSettingsAboutMenuWidth(state.aboutInfo)
      });
      return;
    }

    openSubmenu(kind, event, options);
  }

  function openDisplaySubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-display', event, { placement: 'left-top' });
  }

  function openLockScreenSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-lock-screen', event, { placement: 'left-top' });
  }

  function openThemeSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-theme', event, { placement: 'left-top', preferredWidth: SETTINGS_THEME_MENU_WIDTH });
  }

  function openAboutSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSettingsSubmenu('settings-about', event, { placement: 'left-top' });
  }

  return (
    <section
      className={['floating-menu-surface', 'is-open', className].filter(Boolean).join(' ')}
      onMouseMove={(event) => {
        syncHoveredFloatingMenuRow(event);
        closeFloatingSubmenusFromParentPointer(event, closeSubmenu);
      }}
      onMouseLeave={clearHoveredFloatingMenuRow}
    >
      <label className="floating-menu-row settings-menu-row settings-switch-row">
        <span>开机自启</span>
        <input type="checkbox" checked={autoLaunch} onChange={(event) => void toggleAutoLaunch(event.target.checked)} />
      </label>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-display' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openDisplaySubmenu}
        onMouseMove={openDisplaySubmenu}
        onFocus={openDisplaySubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openDisplaySubmenu}>
          <span>提醒显示屏幕</span>
          <small>{formatSelectedDisplays(selectedDisplayIds, state.displays)}</small>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-lock-screen' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openLockScreenSubmenu}
        onMouseMove={openLockScreenSubmenu}
        onFocus={openLockScreenSubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openLockScreenSubmenu}>
          <span>自动熄屏</span>
          <small>{lockScreenAfterIdle ? '开' : '关'}</small>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-theme' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openThemeSubmenu}
        onMouseMove={openThemeSubmenu}
        onFocus={openThemeSubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openThemeSubmenu}>
          <span>外观</span>
          <small>{getThemeModeLabel(themeMode)}</small>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <div
        className={['floating-menu-group settings-menu-group', activeNestedKind === 'settings-about' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
        onPointerEnter={openAboutSubmenu}
        onMouseMove={openAboutSubmenu}
        onFocus={openAboutSubmenu}
      >
        <button className="floating-menu-row floating-menu-parent settings-menu-row" type="button" onClick={openAboutSubmenu}>
          <span>关于软件</span>
          <span className="settings-menu-arrow" aria-hidden="true">›</span>
        </button>
      </div>
      <button className="floating-menu-row settings-menu-row" type="button" onClick={() => window.xiabanla.quitApp()}>
        <span>退出</span>
      </button>
    </section>
  );
}

export function FloatingSettingsMenu() {
  const [state, setState] = useState<SettingsMenuState | null>(null);

  useEffect(() => {
    void loadState();
    const unsubscribeAppSettings = window.xiabanla.onAppSettingsUpdated((settings) => {
      setState((current) => (current ? {
        ...current,
        lockScreenAfterIdle: settings.lockScreenAfterIdle,
        selectedDisplayIds: settings.selectedDisplayIds
      } : current));
    });
    const unsubscribeThemeMode = subscribeThemeMode((themeMode) => {
      setState((current) => (current ? { ...current, themeMode } : current));
    });
    return () => {
      unsubscribeAppSettings();
      unsubscribeThemeMode();
    };

    async function loadState() {
      const [displays, autoLaunch, appSettings, aboutInfo] = await Promise.all([
        window.xiabanla.getDisplays(),
        window.xiabanla.getAutoLaunch(),
        window.xiabanla.getAppSettings(),
        window.xiabanla.getAppAboutInfo()
      ]);
      setState({
        autoLaunch,
        lockScreenAfterIdle: appSettings.lockScreenAfterIdle,
        selectedDisplayIds: appSettings.selectedDisplayIds,
        themeMode: loadThemeMode(),
        displays,
        aboutInfo
      });
    }
  }, []);

  if (!state) {
    return <section className="settings-popover floating-surface-fill"><div className="empty-state">正在加载</div></section>;
  }

  return (
    <SettingsPopover
      className="settings-popover floating-surface-fill"
      state={state}
      onAutoLaunchChange={(autoLaunch) => setState((current) => (current ? { ...current, autoLaunch } : current))}
    />
  );
}
