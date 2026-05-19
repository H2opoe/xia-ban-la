import React from 'react';
import type { Reminder, ReminderMessage } from '../../../shared/types';
import {
  getListMotionClassName,
  getMotionClassName,
  Presence
} from '../../hooks/useMotion';
import { CheckIcon, LinkIcon, PlusIcon, SettingsIcon, UndoIcon } from '../../components/icons';
import { OffWorkReminderItem } from '../offWork/OffWorkReminderItem';
import { ReminderMenuItem } from '../reminders/ReminderMenuItem';
import type { ReminderExpansionMode } from '../reminders/reminderTypes';
import type { DeleteUndoBatch } from './useDeleteUndo';

type AnimatedReminder = {
  key: string;
  item: Reminder;
  phase: 'enter' | 'exit' | 'idle';
};

type MenuPanelViewProps = {
  activeFloatingSurface: string | null;
  animatedMoreReminders: AnimatedReminder[];
  defaultMessageDrafts: ReminderMessage[];
  defaultMessagesSaving: boolean;
  deleteUndoBatch: DeleteUndoBatch;
  displayedMoreRemindersLength: number;
  expandedId: string;
  expandedMode: ReminderExpansionMode;
  hasVisibleOffWorkReminder: boolean;
  hoveredReminderId: string;
  menuPanelClassName: string;
  menuShellClassName: string;
  newReminderActionLabel: string;
  newReminderButtonClassName: string;
  newReminderDraft: Reminder | null;
  newReminderDraftHasTitle: boolean;
  now: Date;
  offWorkDraft: Reminder | null;
  offWorkExpanded: boolean;
  offWorkReminder?: Reminder;
  registerMoreReminderElement: (key: string, element: HTMLElement | null) => void;
  visibleOffWorkReminder: Reminder | null;
  onAddDefaultMessage: () => void;
  onAddOffWorkReminder: () => void;
  onChangeOffWorkReminder: (reminder: Reminder) => void;
  onChangeReminder: (reminder: Reminder, isDraft: boolean) => void;
  onClickPanelAfterTitleWarningClose: (event: React.MouseEvent<HTMLElement>) => void;
  onCloseQuickEdit: (reminder: Reminder) => void;
  onCollapseOffWork: () => void;
  onCommitQuickEdit: (reminder: Reminder) => void;
  onDeleteDefaultMessage: (id: string) => void;
  onMouseDownPanel: (event: React.MouseEvent<HTMLElement>) => void;
  onOpenReminderMenu: (reminder: Reminder, event: React.MouseEvent, source: 'pointer' | 'info') => void;
  onOpenSettings: (element: Element) => void;
  onPrepareReminderBlankClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPreviewOffWorkReminder: (reminder: Reminder) => void;
  onQuickEdit: (reminder: Reminder) => void;
  onReminderBlankClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onReminderHover: (event: React.MouseEvent<HTMLDivElement>) => void;
  onReminderHoverLeave: () => void;
  onResetDefaultMessages: () => void;
  onRestoreDeletedReminders: () => void;
  onSubmitOffWorkDraft: () => void;
  onToggleExternalPanel: (element: Element) => void;
  onToggleNewReminderDraft: () => void;
  onToggleOffWork: () => void;
  onUpdateDefaultMessage: (id: string, patch: Partial<ReminderMessage>) => void;
};

export function MenuPanelView(props: MenuPanelViewProps) {
  return (
    <main
      className={props.menuShellClassName}
      onMouseDownCapture={props.onMouseDownPanel}
      onClickCapture={props.onClickPanelAfterTitleWarningClose}
    >
      <section className={props.menuPanelClassName}>
        <header className="menu-header">
          <h1>下班啦</h1>
          <p>一个全屏提醒工具</p>
        </header>

        <section className="off-work-section">
          {props.visibleOffWorkReminder ? (
            <OffWorkReminderItem
              reminder={props.visibleOffWorkReminder}
              now={props.now}
              expanded={props.offWorkExpanded}
              adding={Boolean(props.offWorkDraft)}
              defaultMessageDrafts={props.defaultMessageDrafts}
              defaultMessagesSaving={props.defaultMessagesSaving}
              onCollapse={props.onCollapseOffWork}
              onToggle={props.onToggleOffWork}
              onChange={props.onChangeOffWorkReminder}
              onPreview={() => props.onPreviewOffWorkReminder(props.visibleOffWorkReminder as Reminder)}
              onSubmitAdd={props.onSubmitOffWorkDraft}
              onAddDefaultMessage={props.onAddDefaultMessage}
              onUpdateDefaultMessage={props.onUpdateDefaultMessage}
              onDeleteDefaultMessage={props.onDeleteDefaultMessage}
              onResetDefaultMessages={props.onResetDefaultMessages}
            />
          ) : (
            <button type="button" className="menu-row primary-row" onClick={props.onAddOffWorkReminder}>添加下班提醒</button>
          )}
        </section>

        <section className="reminders-section">
          <h2>更多提醒</h2>
          <div
            className="compact-list quick-create-list"
            onMouseDown={props.onPrepareReminderBlankClick}
            onMouseOver={props.onReminderHover}
            onMouseMove={props.onReminderHover}
            onMouseLeave={props.onReminderHoverLeave}
            onClick={props.onReminderBlankClick}
          >
            <Presence visible={props.displayedMoreRemindersLength === 0}>
              {(phase) => <div className={getMotionClassName('empty-state', phase)}>暂无更多提醒</div>}
            </Presence>
            {props.animatedMoreReminders.map(({ key, item: reminder, phase }) => {
              const isDraft = props.newReminderDraft?.id === reminder.id;
              return (
                <ReminderMenuItem
                  key={key}
                  itemRef={(element) => props.registerMoreReminderElement(key, element)}
                  className={getListMotionClassName('reminder-menu-item', phase)}
                  reminder={reminder}
                  workdayReminder={props.offWorkReminder}
                  now={props.now}
                  isDraft={isDraft}
                  isHovered={props.hoveredReminderId === reminder.id}
                  expandedMode={props.expandedId === reminder.id ? props.expandedMode : null}
                  onQuickEdit={() => props.onQuickEdit(reminder)}
                  onCloseQuickEdit={() => props.onCloseQuickEdit(reminder)}
                  onCommitQuickEdit={props.onCommitQuickEdit}
                  onChange={(nextReminder) => props.onChangeReminder(nextReminder, isDraft)}
                  onOpenMenu={(event, source) => props.onOpenReminderMenu(reminder, event, source)}
                />
              );
            })}
          </div>
        </section>

        <div className="settings-anchor">
          <button
            className={props.activeFloatingSurface === 'settings' ? 'icon-button floating-surface-toggle selected' : 'icon-button floating-surface-toggle'}
            type="button"
            disabled={props.offWorkExpanded}
            onClick={(event) => {
              event.stopPropagation();
              props.onOpenSettings(event.currentTarget);
            }}
            aria-label="设置"
            title="设置"
          >
            <SettingsIcon />
          </button>
        </div>

        <footer className="menu-footer">
          <div className="external-sync-anchor">
            <button
              className={props.activeFloatingSurface === 'external-sync' ? 'icon-button footer-icon-button floating-surface-toggle selected' : 'icon-button footer-icon-button floating-surface-toggle'}
              type="button"
              onClick={(event) => props.onToggleExternalPanel(event.currentTarget)}
              aria-controls="external-sync-panel"
              aria-expanded={props.activeFloatingSurface === 'external-sync'}
              aria-label="打开或关闭同步二级菜单"
              title="打开或关闭同步二级菜单"
            >
              <LinkIcon />
            </button>
          </div>
          <button
            className={props.newReminderButtonClassName}
            data-reminder-draft-action
            type="button"
            onClick={props.onToggleNewReminderDraft}
            aria-label={props.newReminderActionLabel}
            aria-pressed={Boolean(props.newReminderDraft)}
            title={props.newReminderActionLabel}
          >
            {props.newReminderDraftHasTitle ? <CheckIcon /> : <PlusIcon />}
          </button>
        </footer>
        <Presence visible={Boolean(props.deleteUndoBatch)}>
          {(phase) => props.deleteUndoBatch && (
            <div
              key={props.deleteUndoBatch.version}
              className={getMotionClassName('delete-undo-toast', phase)}
            >
              <button type="button" onClick={props.onRestoreDeletedReminders}>
                <UndoIcon />
                <span>撤销</span>
                <span className="delete-undo-progress" aria-hidden="true" />
              </button>
            </div>
          )}
        </Presence>
      </section>
    </main>
  );
}
