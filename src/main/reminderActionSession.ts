export class ReminderActionSession {
  private readonly previewSourceIds = new Map<string, string>();

  registerPreview(previewReminderId: string, sourceReminderId: string) {
    this.previewSourceIds.set(previewReminderId, sourceReminderId);
  }

  consumeActionId(reminderId: string) {
    const actionReminderId = this.previewSourceIds.get(reminderId) || reminderId;
    this.previewSourceIds.delete(reminderId);
    return actionReminderId;
  }

  consumePreview(reminderId: string) {
    const isPreviewReminder = this.previewSourceIds.has(reminderId) || reminderId.endsWith(':preview');
    this.previewSourceIds.delete(reminderId);
    return isPreviewReminder;
  }

  clear() {
    this.previewSourceIds.clear();
  }
}
