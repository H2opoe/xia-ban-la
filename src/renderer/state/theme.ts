import type { ThemeMode } from '../../shared/types';

const THEME_MODE_CHANGED_EVENT = 'xiabanla:theme-mode-changed';

let cachedThemeMode: ThemeMode = 'system';

export function loadThemeMode(): ThemeMode {
  return cachedThemeMode;
}

export async function initializeThemeMode() {
  const settings = await window.xiabanla.getAppSettings();
  applyThemeMode(settings.themeMode);
  return settings.themeMode;
}

export async function saveThemeMode(nextThemeMode: ThemeMode) {
  applyThemeMode(nextThemeMode);
  const settings = await window.xiabanla.setThemeMode(nextThemeMode);
  applyThemeMode(settings.themeMode);
  return settings.themeMode;
}

export function subscribeThemeMode(callback: (themeMode: ThemeMode) => void) {
  function syncLocalThemeMode(event: Event) {
    if (event instanceof CustomEvent && isThemeMode(event.detail)) {
      callback(event.detail);
    }
  }

  const unsubscribeAppSettings = window.xiabanla.onAppSettingsUpdated((settings) => {
    applyThemeMode(settings.themeMode);
  });
  window.addEventListener(THEME_MODE_CHANGED_EVENT, syncLocalThemeMode);

  return () => {
    unsubscribeAppSettings();
    window.removeEventListener(THEME_MODE_CHANGED_EVENT, syncLocalThemeMode);
  };
}

function applyThemeMode(themeMode: ThemeMode) {
  if (cachedThemeMode === themeMode) {
    return;
  }
  cachedThemeMode = themeMode;
  window.dispatchEvent(new CustomEvent(THEME_MODE_CHANGED_EVENT, { detail: themeMode }));
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}
