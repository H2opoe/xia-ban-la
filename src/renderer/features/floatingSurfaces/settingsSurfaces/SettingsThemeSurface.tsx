import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../../../shared/types';
import { initializeThemeMode, loadThemeMode, saveThemeMode, subscribeThemeMode } from '../../../state/theme';
import { FloatingMenuSurface } from '../floatingSurfaceModel';

export function FloatingSettingsThemeMenu() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());

  useEffect(() => {
    void initializeThemeMode().then(setThemeMode);
    return subscribeThemeMode(setThemeMode);
  }, []);

  function updateTheme(nextThemeMode: ThemeMode) {
    setThemeMode(nextThemeMode);
    void saveThemeMode(nextThemeMode).then(setThemeMode);
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
