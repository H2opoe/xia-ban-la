import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../../../shared/types';
import { loadThemeMode, saveThemeMode, subscribeThemeMode } from '../../../state/theme';
import { FloatingMenuSurface } from '../floatingSurfaceModel';

export function FloatingSettingsThemeMenu() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());

  useEffect(() => subscribeThemeMode(setThemeMode), []);

  function updateTheme(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    saveThemeMode(nextThemeMode);
  }

  return (
    <FloatingMenuSurface className="settings-theme-submenu">
      {[
        { label: '跟随系统', value: 'system' as const },
        { label: '浅色', value: 'light' as const },
        { label: '深色', value: 'dark' as const }
      ].map((option) => (
        <button className={themeMode === option.value ? 'selected' : ''} type="button" key={option.value} onClick={() => updateTheme(option.value)}>
          {option.label}
        </button>
      ))}
    </FloatingMenuSurface>
  );
}
