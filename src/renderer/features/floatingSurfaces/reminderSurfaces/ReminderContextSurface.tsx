import React, { useEffect, useState } from 'react';
import type { Reminder } from '../../../../shared/types';
import { TimeField } from '../../../components/ReminderFields';
import { createCompletionPatch } from '../../../domain/reminderFactory';
import {
  clearHoveredFloatingMenuRow,
  closeFloatingSubmenusFromParentPointer,
  FloatingMenuSurface,
  syncHoveredFloatingMenuRow,
  useFloatingSubmenu
} from '../floatingSurfaceModel';
import { useEditableReminder } from './useEditableReminder';

function ReminderContextMenu(props: {
  reminder: Reminder;
  className?: string;
  style?: React.CSSProperties;
  onClose: () => void;
  onSaveReminder?: (reminder: Reminder) => Promise<Reminder> | Reminder;
  onRequestDelete?: (reminder: Reminder) => Promise<void> | void;
}) {
  const {
    reminder: initialReminder,
    className = 'context-menu',
    style,
    onClose,
    onSaveReminder,
    onRequestDelete
  } = props;
  const [reminder, setReminder] = useState<Reminder>(initialReminder);
  const { activeNestedKind, openSubmenu, closeSubmenu } = useFloatingSubmenu();

  useEffect(() => {
    setReminder(initialReminder);
  }, [initialReminder]);

  async function savePatch(patch: Partial<Reminder>, close = true) {
    const nextReminder = { ...reminder, ...patch };
    const savedReminder = onSaveReminder
      ? await onSaveReminder(nextReminder)
      : await window.xiabanla.saveReminder(nextReminder);
    setReminder(savedReminder);
    if (close) {
      onClose();
    }
  }

  async function deleteCurrentReminder() {
    if (onRequestDelete) {
      await onRequestDelete(reminder);
    } else {
      await window.xiabanla.requestReminderDelete(reminder.id);
    }
    onClose();
  }

  function openDateSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSubmenu('reminder-date', event, { reminderId: reminder.id, placement: 'right-top' });
  }

  function openRepeatSubmenu(event: React.SyntheticEvent<HTMLElement>) {
    openSubmenu('reminder-repeat', event, { reminderId: reminder.id, placement: 'right-top' });
  }

  const isExternalSynced = Boolean(reminder.linkedExternalSource);
  return (
    <section
      className={['floating-menu-surface', 'is-open', className].filter(Boolean).join(' ')}
      style={style}
      onMouseMove={(event) => {
        syncHoveredFloatingMenuRow(event);
        closeFloatingSubmenusFromParentPointer(event, closeSubmenu);
      }}
      onMouseLeave={clearHoveredFloatingMenuRow}
    >
      {!isExternalSynced && (
        <button className="floating-menu-row" type="button" role="menuitem" onClick={() => void savePatch(createCompletionPatch(reminder))}>
          {reminder.completed ? '标为未完成' : '标为完成'}
        </button>
      )}
      {!isExternalSynced && (
        <div
          className={['floating-menu-group context-menu-group', activeNestedKind === 'reminder-date' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
          role="menuitem"
          tabIndex={0}
          onPointerEnter={openDateSubmenu}
          onMouseMove={openDateSubmenu}
          onFocus={openDateSubmenu}
        >
          <button
            className="floating-menu-row floating-menu-parent context-menu-parent"
            type="button"
            onClick={openDateSubmenu}
          >
            <span>截止日期</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {!isExternalSynced && (
        <label className="floating-menu-row context-time-row">
          <span>截止时间</span>
          <TimeField
            value={reminder.dailyTime}
            onChange={(dailyTime) => savePatch({ dailyTime }, false)}
            onKeyboardCommit={onClose}
          />
        </label>
      )}
      {!isExternalSynced && (
        <div
          className={['floating-menu-group context-menu-group', activeNestedKind === 'reminder-repeat' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
          role="menuitem"
          tabIndex={0}
          onPointerEnter={openRepeatSubmenu}
          onMouseMove={openRepeatSubmenu}
          onFocus={openRepeatSubmenu}
        >
          <button
            className="floating-menu-row floating-menu-parent context-menu-parent"
            type="button"
            onClick={openRepeatSubmenu}
          >
            <span>重复</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      <button className="floating-menu-row context-danger" type="button" onClick={() => void deleteCurrentReminder()}>
        {isExternalSynced ? '取消同步' : '删除'}
      </button>
      {isExternalSynced && <div className="context-readonly-hint">该提醒同步自本机日历或提醒事项，请到对应软件内修改。</div>}
    </section>
  );
}

export function FloatingReminderContextMenu(props: { reminderId: string }) {
  const { reminderId } = props;
  const [editableReminder] = useEditableReminder(reminderId);

  if (!editableReminder) {
    return <FloatingMenuSurface className="context-menu"><div className="context-readonly-hint">提醒不存在</div></FloatingMenuSurface>;
  }

  return (
    <ReminderContextMenu
      className="context-menu floating-surface-fill"
      reminder={editableReminder.reminder}
      onSaveReminder={editableReminder.isDraft ? (reminder) => window.xiabanla.saveDraftReminder(reminder) : undefined}
      onRequestDelete={editableReminder.isDraft ? (reminder) => window.xiabanla.deleteDraftReminder(reminder.id) : undefined}
      onClose={() => void window.xiabanla.closeMenuFloatingSurface()}
    />
  );
}
