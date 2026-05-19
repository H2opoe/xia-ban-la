import type { AppAboutInfo, DisplayInfo, ThemeMode } from '../../../../shared/types';

export const DEFAULT_APP_ABOUT_INFO: AppAboutInfo = {
  version: '0.1.0',
  currentYear: new Date().getFullYear()
};

export type SettingsMenuState = {
  autoLaunch: boolean;
  lockScreenAfterIdle: boolean;
  selectedDisplayIds: string[];
  themeMode: ThemeMode;
  displays: DisplayInfo[];
  aboutInfo: AppAboutInfo;
};
