export function getHoveredReminderIdFromTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const hoveredItem = element?.closest<HTMLElement>('.reminder-menu-item[data-reminder-id]');
  return hoveredItem?.dataset.reminderId || '';
}

export function getTitleWarningAnchorElement(reminderId: string) {
  const reminderElement = getReminderMenuItemElement(reminderId);
  const infoButton = reminderElement?.querySelector<HTMLElement>('.task-info-button');
  if (infoButton) {
    return infoButton;
  }
  if (reminderElement) {
    return reminderElement;
  }

  return document.querySelector<HTMLElement>('[data-reminder-draft-action]');
}

export function focusReminderTitleInput(reminderId: string) {
  window.requestAnimationFrame(() => {
    const input = getReminderMenuItemElement(reminderId)?.querySelector<HTMLInputElement>('.inline-title-input');
    if (!input) {
      return;
    }

    input.focus();
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
  });
}

export function getReminderMenuItemElement(reminderId: string) {
  return document.querySelector<HTMLElement>(`[data-reminder-id="${escapeCssAttributeValue(reminderId)}"]`);
}

function escapeCssAttributeValue(value: string) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }

  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
