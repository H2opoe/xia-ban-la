import type { Reminder } from '../../../../shared/types';
import { ReminderRepeatPicker } from '../../../components/ReminderRepeatPicker';
import { FloatingMenuSurface } from '../floatingSurfaceModel';
import { useEditableReminder } from './useEditableReminder';

export function FloatingReminderRepeatMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [editableReminder, setEditableReminder] = useEditableReminder(reminderId);

  async function savePatch(patch: Partial<Reminder>) {
    if (!editableReminder) {
      return;
    }
    const nextReminder = { ...editableReminder.reminder, ...patch };
    const saved = editableReminder.isDraft
      ? await window.xiabanla.saveDraftReminder(nextReminder)
      : await window.xiabanla.saveReminder(nextReminder);
    setEditableReminder({ ...editableReminder, reminder: saved });
  }

  return (
    <FloatingMenuSurface className="context-submenu context-repeat-submenu" role="menu">
      {editableReminder ? (
        <ReminderRepeatPicker
          reminder={editableReminder.reminder}
          workdayReminder={editableReminder.workdayReminder}
          allowNoRepeat
          onChange={(patch) => void savePatch(patch)}
        />
      ) : <div className="context-readonly-hint">提醒不存在</div>}
    </FloatingMenuSurface>
  );
}
