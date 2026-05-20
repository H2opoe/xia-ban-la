import type { MenuFloatingSurfaceKind } from '../shared/types.js';

export const MENU_FLOATING_POINTER_POLL_MS = 80;
export const MENU_NESTED_HOVER_CLOSE_DELAY_MS = 180;
export const MENU_FLOATING_HOVER_BRIDGE_PX = 18;

const SETTINGS_TERTIARY_MENU_WIDTH = 210;
const SETTINGS_THEME_MENU_WIDTH = 105;

export const MENU_FLOATING_SURFACE_SIZES: Record<MenuFloatingSurfaceKind, { width: number; height: number }> = {
  settings: { width: 160, height: 265 },
  'settings-display': { width: SETTINGS_TERTIARY_MENU_WIDTH, height: 220 },
  'settings-lock-screen': { width: SETTINGS_TERTIARY_MENU_WIDTH, height: 122 },
  'settings-theme': { width: SETTINGS_THEME_MENU_WIDTH, height: 116 },
  'settings-about': { width: 520, height: 358 },
  donation: { width: 292, height: 374 },
  'external-sync': { width: 292, height: 260 },
  'reminder-context': { width: 178, height: 260 },
  'title-warning': { width: 190, height: 116 },
  'reminder-date': { width: 218, height: 300 },
  'reminder-repeat': { width: 204, height: 176 },
  'today-override': { width: 176, height: 148 },
  'default-messages': { width: 238, height: 280 }
};

export const MENU_FLOATING_NESTED_KINDS = new Set<MenuFloatingSurfaceKind>([
  'settings-display',
  'settings-lock-screen',
  'settings-theme',
  'settings-about',
  'donation',
  'reminder-date',
  'reminder-repeat',
  'today-override',
  'default-messages'
]);
