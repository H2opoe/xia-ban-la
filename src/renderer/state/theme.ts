import type { ThemeMode } from '../../shared/types';

const THEME_STORAGE_KEY = 'xiabanla.themeMode';
const THEME_MODE_CHANGED_EVENT = 'xiabanla:theme-mode-changed';
const THEME_BROADCAST_CHANNEL = 'xiabanla:theme-mode';

export function loadThemeMode(): ThemeMode {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function saveThemeMode(nextThemeMode: ThemeMode) {
  window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode);
  window.dispatchEvent(new CustomEvent(THEME_MODE_CHANGED_EVENT, { detail: nextThemeMode }));
  if (typeof BroadcastChannel === 'undefined') {
    return;
  }
  const channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
  channel.postMessage(nextThemeMode);
  channel.close();
}

export function subscribeThemeMode(callback: (themeMode: ThemeMode) => void) {
  function syncStoredThemeMode(event: StorageEvent) {
    if (event.key === THEME_STORAGE_KEY) {
      callback(loadThemeMode());
    }
  }

  function syncLocalThemeMode(event: Event) {
    if (event instanceof CustomEvent && isThemeMode(event.detail)) {
      callback(event.detail);
    }
  }

  function syncBroadcastThemeMode(event: MessageEvent) {
    if (isThemeMode(event.data)) {
      window.localStorage.setItem(THEME_STORAGE_KEY, event.data);
      callback(event.data);
    }
  }

  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(THEME_BROADCAST_CHANNEL);
  channel?.addEventListener('message', syncBroadcastThemeMode);
  window.addEventListener('storage', syncStoredThemeMode);
  window.addEventListener(THEME_MODE_CHANGED_EVENT, syncLocalThemeMode);

  return () => {
    channel?.removeEventListener('message', syncBroadcastThemeMode);
    channel?.close();
    window.removeEventListener('storage', syncStoredThemeMode);
    window.removeEventListener(THEME_MODE_CHANGED_EVENT, syncLocalThemeMode);
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}
