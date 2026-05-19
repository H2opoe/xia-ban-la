import { useEffect } from 'react';

export function useReminderQuickDismiss(enabled: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || (event.key !== 'Escape' && event.key !== 'Enter')) {
        return;
      }
      // Esc 是全屏提醒的兜底关闭入口，即使焦点在自定义稍后输入框里也要生效。
      if (event.key === 'Enter' && shouldKeepReminderKeyboardEventInField(event.target)) {
        return;
      }

      event.preventDefault();
      onDismiss();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onDismiss]);
}

function shouldKeepReminderKeyboardEventInField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
