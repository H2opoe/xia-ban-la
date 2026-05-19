import React, { useEffect, useState } from 'react';
import type { MenuFloatingSurfaceKind, Reminder, ReminderMessage } from '../../../shared/types';
import { PauseIcon, PreviewIcon } from '../../components/icons';
import { RollingCountdown, TimeField } from '../../components/ReminderFields';
import { ReminderRepeatPicker } from '../../components/ReminderRepeatPicker';
import {
  formatReminderNotifyTime,
  formatTodayOffWorkTime,
  getOffWorkCountdownState,
  getTodayOverrideLabel
} from '../../domain/reminderText';
import {
  closeFloatingSubmenusFromParentPointer,
  useFloatingSubmenu
} from '../floatingSurfaces/floatingSurfaceModel';
import { isInputMethodComposing } from '../../hooks/useInputMethodGuard';
import { getMotionClassName, Presence } from '../../hooks/useMotion';

type OffWorkReminderItemProps = {
  reminder: Reminder;
  now: Date;
  expanded: boolean;
  adding?: boolean;
  defaultMessageDrafts: ReminderMessage[];
  defaultMessagesSaving: boolean;
  onChange: (reminder: Reminder) => void;
  onCollapse: () => void;
  onPreview: () => void;
  onSubmitAdd?: () => void;
  onToggle: () => void;
  onAddDefaultMessage: () => void;
  onUpdateDefaultMessage: (id: string, patch: Partial<ReminderMessage>) => void;
  onDeleteDefaultMessage: (id: string) => void;
  onResetDefaultMessages: () => void;
};

export function OffWorkReminderItem(props: OffWorkReminderItemProps) {
  const {
    reminder,
    now,
    expanded,
    adding = false,
    defaultMessageDrafts,
    onChange,
    onCollapse,
    onPreview,
    onSubmitAdd,
    onToggle
  } = props;
  const todayOverrideLabel = getTodayOverrideLabel(reminder);
  const countdownState = getOffWorkCountdownState(reminder, now);
  const reminderNotifyText = formatReminderNotifyTime(reminder, now);
  const { activeNestedKind, openSubmenu, closeSubmenu } = useFloatingSubmenu();
  const [advanceMinutesInput, setAdvanceMinutesInput] = useState(String(reminder.advanceMinutes));

  useEffect(() => {
    setAdvanceMinutesInput(String(reminder.advanceMinutes));
  }, [reminder.id, reminder.advanceMinutes]);

  function update(patch: Partial<Reminder>) {
    onChange({ ...reminder, ...patch });
  }

  function updateAdvanceMinutesInput(value: string) {
    setAdvanceMinutesInput(value);
    if (!value.trim()) {
      return;
    }

    update({ advanceMinutes: Math.max(0, Number(value) || 0) });
  }

  function commitEmptyAdvanceMinutesInputAsZero() {
    if (advanceMinutesInput.trim()) {
      return;
    }

    setAdvanceMinutesInput('0');
    if (reminder.advanceMinutes !== 0) {
      update({ advanceMinutes: 0 });
    }
  }

  function openTertiaryMenu(kind: MenuFloatingSurfaceKind, event: React.SyntheticEvent<HTMLElement>) {
    openSubmenu(kind, event, {
      reminderId: reminder.id,
      placement: 'right-top'
    });
  }

  function openTodayOverrideMenu(event: React.SyntheticEvent<HTMLElement>) {
    openTertiaryMenu('today-override', event);
  }

  function openDefaultMessagesMenu(event: React.SyntheticEvent<HTMLElement>) {
    openTertiaryMenu('default-messages', event);
  }

  function updateDailyTime(dailyTime: string) {
    update({
      dailyTime,
      todayOverrideTime: undefined,
      todayOverrideDate: undefined
    });
  }

  function pauseReminder() {
    update({ enabled: false });
    onCollapse();
  }

  function saveAndExitExpandedEdit(event: React.KeyboardEvent<HTMLElement>) {
    if (isInputMethodComposing(event) || (event.key !== 'Enter' && event.key !== 'Escape')) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('input')) {
      return;
    }

    event.preventDefault();
    if (adding || onSubmitAdd) {
      onSubmitAdd?.();
      return;
    }
    onCollapse();
  }

  return (
    <article
      className={[
        'reminder-menu-item',
        'off-work-item',
        expanded ? 'off-work-item-expanded' : '',
        adding ? 'off-work-item-adding' : ''
      ].filter(Boolean).join(' ')}
      data-reminder-id={reminder.id}
    >
      <div className="countdown-card">
        <button type="button" className="countdown-card-main" onClick={onToggle}>
          <span className="countdown-label">下班倒计时</span>
          <span className="countdown-main-row">
            <RollingCountdown value={countdownState.text} />
            {countdownState.showTimeMeta && (
              <span className="countdown-meta">
                <small>{formatTodayOffWorkTime(reminder, now)}</small>
                {reminderNotifyText && <small>{reminderNotifyText}</small>}
              </span>
            )}
          </span>
        </button>
      </div>
      <Presence visible={expanded}>
        {(phase) => (
          <div
            className={getMotionClassName('submenu', phase)}
            onKeyDown={saveAndExitExpandedEdit}
            onMouseMove={(event) => closeFloatingSubmenusFromParentPointer(event, closeSubmenu)}
          >
            <div className="submenu-grid">
              <label>
                下班时间
                <TimeField value={reminder.dailyTime} onChange={updateDailyTime} />
              </label>
              <label>
                提前提醒
                <span className="unit-input">
                  <input
                    type="number"
                    min="0"
                    value={advanceMinutesInput}
                    onChange={(event) => updateAdvanceMinutesInput(event.target.value)}
                    onBlur={commitEmptyAdvanceMinutesInputAsZero}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <span>分钟</span>
                </span>
              </label>
            </div>

            <ReminderRepeatPicker reminder={reminder} onChange={(patch) => update(patch)} />

            <div className="tertiary-menu-wrap">
              <button
                type="button"
                className={['menu-row compact-menu-row', activeNestedKind === 'today-override' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
                onPointerEnter={openTodayOverrideMenu}
                onMouseMove={openTodayOverrideMenu}
                onFocus={openTodayOverrideMenu}
                onClick={openTodayOverrideMenu}
              >
                <span>{todayOverrideLabel}</span>
                <small>{reminder.todayOverrideTime || '未设置'}</small>
              </button>
            </div>

            <div className="tertiary-menu-wrap">
              <button
                type="button"
                className={['menu-row compact-menu-row', activeNestedKind === 'default-messages' ? 'submenu-open' : ''].filter(Boolean).join(' ')}
                onPointerEnter={openDefaultMessagesMenu}
                onMouseMove={openDefaultMessagesMenu}
                onFocus={openDefaultMessagesMenu}
                onClick={openDefaultMessagesMenu}
              >
                <span>下班文案</span>
                <small>{defaultMessageDrafts.length} 条</small>
              </button>
            </div>

            {adding && (
              <div className="submenu-actions">
                <button type="button" className="primary-card-action" onClick={onSubmitAdd}>添加</button>
              </div>
            )}
          </div>
        )}
      </Presence>
      {expanded && !adding && (
        <div className="off-work-card-actions">
          <button type="button" className="menu-action-button" onClick={pauseReminder}>
            <PauseIcon />
            <span>暂停提醒</span>
          </button>
          <button type="button" className="menu-action-button" onClick={onPreview}>
            <PreviewIcon />
            <span>预览提醒</span>
          </button>
        </div>
      )}
    </article>
  );
}
