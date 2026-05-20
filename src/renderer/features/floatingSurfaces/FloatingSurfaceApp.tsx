import { useEffect, useState } from 'react';
import type { MenuFloatingSurfaceKind, ThemeMode } from '../../../shared/types';
import { initializeThemeMode, loadThemeMode, subscribeThemeMode } from '../../state/theme';
import { FloatingExternalSyncMenu } from './ExternalSyncSurface';
import {
  FloatingSettingsAboutMenu,
  FloatingSettingsDisplayMenu,
  FloatingSettingsLockScreenMenu,
  FloatingSettingsMenu,
  FloatingSettingsThemeMenu
} from './SettingsSurfaces';
import {
  FloatingReminderContextMenu,
  FloatingReminderDateMenu,
  FloatingReminderRepeatMenu,
  FloatingTitleWarningMenu,
  FloatingTodayOverrideMenu
} from './ReminderSurfaces';
import { FloatingDefaultMessagesMenu } from './DefaultMessagesSurface';
import { FloatingDonationMenu } from './DonationSurface';

type FloatingRoute = {
  kind: MenuFloatingSurfaceKind;
  reminderId?: string;
  restoreTitle?: string;
};

export function FloatingSurfaceApp(props: { route: FloatingRoute }) {
  const { route } = props;
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const themeClassName = themeMode === 'system' ? '' : `theme-${themeMode}`;
  const className = ['floating-surface-shell', themeClassName].filter(Boolean).join(' ');

  useEffect(() => {
    function closeByEscape(event: KeyboardEvent) {
      if (event.repeat || event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      void window.xiabanla.closeMenuFloatingSurface();
    }

    window.addEventListener('keydown', closeByEscape);
    return () => window.removeEventListener('keydown', closeByEscape);
  }, []);

  useEffect(() => {
    void initializeThemeMode().then(setThemeMode);
    return subscribeThemeMode(setThemeMode);
  }, []);

  return (
    <main className={className}>
      {route.kind === 'settings' && <FloatingSettingsMenu />}
      {route.kind === 'settings-display' && <FloatingSettingsDisplayMenu />}
      {route.kind === 'settings-lock-screen' && <FloatingSettingsLockScreenMenu />}
      {route.kind === 'settings-theme' && <FloatingSettingsThemeMenu />}
      {route.kind === 'settings-about' && <FloatingSettingsAboutMenu />}
      {route.kind === 'donation' && <FloatingDonationMenu />}
      {route.kind === 'external-sync' && <FloatingExternalSyncMenu />}
      {route.kind === 'reminder-context' && route.reminderId && <FloatingReminderContextMenu reminderId={route.reminderId} />}
      {route.kind === 'title-warning' && route.reminderId && (
        <FloatingTitleWarningMenu reminderId={route.reminderId} restoreTitle={route.restoreTitle} />
      )}
      {route.kind === 'reminder-date' && route.reminderId && <FloatingReminderDateMenu reminderId={route.reminderId} />}
      {route.kind === 'reminder-repeat' && route.reminderId && <FloatingReminderRepeatMenu reminderId={route.reminderId} />}
      {route.kind === 'today-override' && route.reminderId && <FloatingTodayOverrideMenu reminderId={route.reminderId} />}
      {route.kind === 'default-messages' && route.reminderId && <FloatingDefaultMessagesMenu />}
    </main>
  );
}
