import React, { useEffect, useRef, useState } from 'react';
import { getReminderDueDateKey } from '../../../shared/reminderSchedule';
import type { Reminder } from '../../../shared/types';
import { DateField, TimeField } from '../../components/ReminderFields';
import { toDateKey } from '../../domain/dateTimeInput';
import { createCompletionPatch } from '../../domain/reminderFactory';
import { isReminderPastDue } from '../../domain/reminderSort';
import {
  createDueDatePatch,
  formatTaskRule
} from '../../domain/reminderText';
import { useInputMethodGuard } from '../../hooks/useInputMethodGuard';
import { getMotionClassName, Presence } from '../../hooks/useMotion';
import type { ReminderExpansionMode } from './reminderTypes';

type ReminderMenuItemProps = {
  className?: string;
  itemRef?: (element: HTMLElement | null) => void;
  reminder: Reminder;
  workdayReminder?: Reminder;
  now: Date;
  isDraft?: boolean;
  isHovered?: boolean;
  expandedMode: ReminderExpansionMode | null;
  onChange: (reminder: Reminder) => void;
  onQuickEdit: () => void;
  onCloseQuickEdit: () => void;
  onCommitQuickEdit: (reminder: Reminder) => void;
  onOpenMenu: (event: React.MouseEvent, source: 'pointer' | 'info') => void;
};

export function ReminderMenuItem(props: ReminderMenuItemProps) {
  const {
    className = 'reminder-menu-item',
    itemRef,
    reminder,
    workdayReminder,
    now,
    isDraft = false,
    isHovered = false,
    expandedMode,
    onChange,
    onQuickEdit,
    onCloseQuickEdit,
    onCommitQuickEdit,
    onOpenMenu
  } = props;
  const currentReminderRef = useRef(reminder);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleComposingRef = useRef(false);
  const [titleDraft, setTitleDraft] = useState(reminder.name);
  const inputMethodGuard = useInputMethodGuard();
  const itemClassName = [
    className,
    isDraft ? 'reminder-menu-item-draft' : '',
    isHovered ? 'reminder-menu-item-hovered' : '',
    expandedMode === 'quick' ? 'reminder-menu-item-quick-edit' : ''
  ].filter(Boolean).join(' ');
  const isPastDue = isReminderPastDue(reminder, now);
  const ruleClassName = isPastDue ? 'task-deadline-overdue' : '';
  const isExternalSynced = Boolean(reminder.linkedExternalSource);

  useEffect(() => {
    currentReminderRef.current = reminder;
  }, [reminder]);

  useEffect(() => {
    if (titleComposingRef.current) {
      return;
    }
    setTitleDraft(reminder.name);
  }, [reminder.name]);

  useEffect(() => {
    if (expandedMode !== 'quick') {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      focusTitleInput();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [expandedMode, reminder.id]);

  function update(patch: Partial<Reminder>) {
    const nextReminder = { ...currentReminderRef.current, ...patch };
    currentReminderRef.current = nextReminder;
    onChange(nextReminder);
  }

  function updateTitleDraft(nextTitle: string) {
    setTitleDraft(nextTitle);

    if (titleComposingRef.current) {
      return;
    }

    update({ name: nextTitle });
  }

  function finishTitleComposition(event: React.CompositionEvent<HTMLInputElement>) {
    titleComposingRef.current = false;
    const nextTitle = event.currentTarget.value;
    setTitleDraft(nextTitle);
    update({ name: nextTitle });
  }

  function handleQuickEditKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (inputMethodGuard.shouldIgnoreEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCommitQuickEdit(currentReminderRef.current);
    }
  }

  function commitQuickFieldFromKeyboard() {
    if (!currentReminderRef.current.name.trim()) {
      focusTitleInput();
      return;
    }

    onCommitQuickEdit(currentReminderRef.current);
  }

  function focusTitleInput() {
    window.requestAnimationFrame(() => {
      const titleInput = titleInputRef.current;
      if (!titleInput) {
        return;
      }

      titleInput.focus();
      const cursorPosition = titleInput.value.length;
      titleInput.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function toggleCompletionAndExitEdit() {
    const nextReminder = {
      ...currentReminderRef.current,
      ...createCompletionPatch(currentReminderRef.current)
    };
    currentReminderRef.current = nextReminder;
    onChange(nextReminder);

    if (expandedMode === 'quick') {
      onCommitQuickEdit(nextReminder);
    }
  }

  function closeQuickEditFromEmptyTitle(event: React.MouseEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (!input.value.trim()) {
      return;
    }

    const styles = window.getComputedStyle(input);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.font = styles.font;
    const textWidth = context.measureText(input.value).width;
    const clickX = event.clientX - input.getBoundingClientRect().left;
    const textEndX = parseFloat(styles.paddingLeft || '0') + textWidth + 8;

    // 标题输入框本身铺满整行，点击文字后的空白区域时按 macOS 提醒事项 App 的习惯收起编辑。
    if (clickX > textEndX) {
      event.preventDefault();
      event.stopPropagation();
      onCloseQuickEdit();
    }
  }

  return (
    <article
      ref={itemRef}
      className={itemClassName}
      data-reminder-id={reminder.id}
      onCompositionStart={inputMethodGuard.markCompositionStart}
      onCompositionEnd={inputMethodGuard.markCompositionEnd}
      onContextMenu={(event) => {
        if (!isDraft) {
          onOpenMenu(event, 'pointer');
        }
      }}
    >
      <div className="task-row">
        <button
          className={reminder.completed ? 'task-check completed' : 'task-check'}
          aria-label={reminder.completed ? '标为未完成' : '标为已完成'}
          disabled={isExternalSynced}
          onClick={toggleCompletionAndExitEdit}
        />
        <div
          className={isExternalSynced ? 'task-content task-content-readonly' : 'task-content'}
          onClick={isExternalSynced ? undefined : onQuickEdit}
        >
          {expandedMode === 'quick' ? (
            <input
              ref={titleInputRef}
              className="inline-title-input"
              value={titleDraft}
              placeholder={isDraft ? '请输入标题' : undefined}
              onChange={(event) => updateTitleDraft(event.target.value)}
              onCompositionStart={() => {
                titleComposingRef.current = true;
              }}
              onCompositionEnd={finishTitleComposition}
              onMouseDown={closeQuickEditFromEmptyTitle}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={handleQuickEditKeyDown}
              aria-label="提醒标题"
            />
          ) : (
            <span className="task-title-line">
              <span className={isDraft && !reminder.name.trim() ? 'task-title-placeholder' : ''}>
                {reminder.name || (isDraft ? '请输入标题' : '')}
              </span>
              {isExternalSynced && <span className="source-badge">本机同步</span>}
            </span>
          )}
          {expandedMode !== 'quick' && <small className={ruleClassName}>{formatTaskRule(reminder, now, workdayReminder)}</small>}
        </div>
        <button
          className="task-info-button floating-surface-toggle"
          onClick={(event) => onOpenMenu(event, 'info')}
          aria-label={isExternalSynced ? '查看同步信息' : '编辑提醒'}
        >
          i
        </button>
      </div>
      <Presence visible={expandedMode === 'quick'}>
        {(phase) => (
          <div className={getMotionClassName('task-quick-editor', phase)} onKeyDown={handleQuickEditKeyDown}>
            <div className="quick-field-row">
              <label className="icon-field">
                <span className="field-icon date-icon" aria-hidden="true" />
                <span className="sr-only">日期</span>
                <DateField
                  value={getReminderDueDateKey(reminder, now) || toDateKey(now)}
                  onChange={(scheduledDate) => update(createDueDatePatch(reminder, scheduledDate))}
                  onKeyboardCommit={commitQuickFieldFromKeyboard}
                />
              </label>
              <label className="icon-field">
                <span className="field-icon time-icon" aria-hidden="true" />
                <span className="sr-only">时间</span>
                {/* 快速编辑会先响应外部 mousedown 收起面板，合法时间需要先进入提醒对象，避免输入框卸载时丢草稿。 */}
                <TimeField
                  value={reminder.dailyTime}
                  commitOnValidChange
                  onChange={(dailyTime) => update({ dailyTime })}
                  onKeyboardCommit={commitQuickFieldFromKeyboard}
                />
              </label>
            </div>
          </div>
        )}
      </Presence>
    </article>
  );
}
