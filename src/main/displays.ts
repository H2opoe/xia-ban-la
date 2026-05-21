import electron from 'electron/main';
import type { DisplayInfo } from '../shared/types.js';

const { screen } = electron;

export function getDisplayInfos(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: display.label || (display.id === primaryId ? `主屏幕 ${index + 1}` : `屏幕 ${index + 1}`),
    isPrimary: display.id === primaryId,
    bounds: display.bounds
  }));
}
