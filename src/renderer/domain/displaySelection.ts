import type { DisplayInfo } from '../../shared/types';

export function updateSelectedDisplayIds(currentDisplayIds: string[], displays: DisplayInfo[], displayId: string, checked: boolean) {
  let selectedDisplayIds = checked
    ? Array.from(new Set([...currentDisplayIds, displayId]))
    : currentDisplayIds.filter((id) => id !== displayId);
  const primaryDisplayId = displays.find((display) => display.isPrimary)?.id || displays[0]?.id;
  if (selectedDisplayIds.length === 0 && primaryDisplayId) {
    selectedDisplayIds = [primaryDisplayId];
  }
  return selectedDisplayIds;
}

export function formatSelectedDisplays(selectedDisplayIds: string[], displays: DisplayInfo[]) {
  const selectedDisplays = displays.filter((display) => selectedDisplayIds.includes(display.id));
  if (selectedDisplays.length === 0) {
    return '默认主屏幕';
  }
  if (selectedDisplays.length === displays.length && displays.length > 1) {
    return '全部屏幕';
  }
  return `${selectedDisplays.length}个屏幕`;
}
