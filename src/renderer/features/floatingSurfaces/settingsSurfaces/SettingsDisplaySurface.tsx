import { useEffect, useState } from 'react';
import type { DisplayInfo } from '../../../../shared/types';
import { updateSelectedDisplayIds } from '../../../domain/displaySelection';
import { FloatingMenuSurface } from '../floatingSurfaceModel';

export function FloatingSettingsDisplayMenu() {
  const [selectedDisplayIds, setSelectedDisplayIds] = useState<string[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.xiabanla.onAppSettingsUpdated((settings) => setSelectedDisplayIds(settings.selectedDisplayIds));
    return unsubscribe;

    async function refresh() {
      const [appSettings, nextDisplays] = await Promise.all([
        window.xiabanla.getAppSettings(),
        window.xiabanla.getDisplays()
      ]);
      setSelectedDisplayIds(appSettings.selectedDisplayIds);
      setDisplays(nextDisplays);
    }
  }, []);

  async function updateDisplay(displayId: string, checked: boolean) {
    const nextSelectedDisplayIds = updateSelectedDisplayIds(selectedDisplayIds, displays, displayId, checked);
    setSelectedDisplayIds(nextSelectedDisplayIds);
    const settings = await window.xiabanla.setSelectedDisplayIds(nextSelectedDisplayIds);
    setSelectedDisplayIds(settings.selectedDisplayIds);
  }

  return (
    <FloatingMenuSurface className="settings-display-submenu">
      {displays.map((display) => (
        <label className="settings-display-row" key={display.id}>
          <input
            type="checkbox"
            checked={selectedDisplayIds.includes(display.id)}
            disabled={selectedDisplayIds.length <= 1 && selectedDisplayIds.includes(display.id)}
            onChange={(event) => void updateDisplay(display.id, event.target.checked)}
          />
          <span title={display.label}>{display.label}</span>
        </label>
      ))}
    </FloatingMenuSurface>
  );
}
