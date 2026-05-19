import { useCallback, useEffect, useRef, useState } from 'react';
import { OFF_WORK_REMINDER_ID } from '../../shared/reminderConstants';
import type { ReminderPayload } from '../../shared/types';
import { MENU_PANEL_ANIMATION_MS } from '../../shared/window';
import { useReminderQuickDismiss } from '../hooks/useReminderQuickDismiss';
import { ArrowUpRightIcon, BellIcon, CloseIcon, MoreIcon } from './icons';

type ReminderOverlayProps = {
  payload?: ReminderPayload;
  onClose?: () => void;
};

export function ReminderOverlay(props: ReminderOverlayProps = {}) {
  const { payload: controlledPayload, onClose } = props;
  const [payload, setPayload] = useState<ReminderPayload | null>(controlledPayload ?? null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (controlledPayload) {
      setPayload(controlledPayload);
      return undefined;
    }

    void window.xiabanla.getReminderPayload().then(setPayload);
    const unsubscribe = window.xiabanla.onReminderPayloadUpdated((nextPayload) => {
      setPayload(nextPayload);
    });
    return unsubscribe;
  }, [controlledPayload]);

  const closeWithAnimation = useCallback((action: () => Promise<void>) => {
    if (closing) {
      return;
    }

    setClosing(true);
    window.setTimeout(() => {
      void action().finally(onClose);
    }, MENU_PANEL_ANIMATION_MS);
  }, [closing, onClose]);

  const closeReminder = useCallback(() => {
    if (!payload) {
      return;
    }

    closeWithAnimation(() => window.xiabanla.dismissReminder(payload.reminderId));
  }, [closeWithAnimation, payload]);

  const enterReminder = useCallback(() => {
    if (!payload) {
      return;
    }

    closeWithAnimation(() => window.xiabanla.enterReminder(payload.reminderId));
  }, [closeWithAnimation, payload]);

  useReminderQuickDismiss(Boolean(payload) && !closing, closeReminder);

  if (!payload) {
    return <div className="overlay loading">正在准备提醒...</div>;
  }

  return (
    <main className={closing ? 'overlay overlay-closing' : 'overlay'}>
      <div className="overlay-content-hit-area">
        <ReminderOverlayContent
          payload={payload}
          onDismiss={closeReminder}
          onEnter={enterReminder}
          onSnooze={(minutes) => closeWithAnimation(() => window.xiabanla.snoozeReminder(payload.reminderId, minutes))}
        />
      </div>
    </main>
  );
}

function ReminderOverlayContent(props: {
  payload: ReminderPayload;
  eyebrow?: string;
  onDismiss: () => void;
  onEnter: () => void;
  onSnooze: (minutes: number) => void;
}) {
  const { payload, eyebrow = '全屏提醒', onDismiss, onEnter, onSnooze } = props;
  const overlayTitle = payload.title.trim() || '提醒';
  const isOffWorkPayload = payload.reminderId === OFF_WORK_REMINDER_ID || payload.reminderId.startsWith(`${OFF_WORK_REMINDER_ID}:`);
  const overlayMessage = isOffWorkPayload ? (payload.message.trim() || overlayTitle) : overlayTitle;
  const overlaySubtitle = isOffWorkPayload && overlayMessage !== overlayTitle ? overlayTitle : '';
  const elapsedLabel = useElapsedReminderLabel();
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  const [customSnoozeDraft, setCustomSnoozeDraft] = useState('10');
  const customSnoozeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!customSnoozeOpen) {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      customSnoozeInputRef.current?.focus();
      customSnoozeInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [customSnoozeOpen]);

  function submitCustomSnooze() {
    const minutes = Number.parseInt(customSnoozeDraft, 10);
    if (!Number.isFinite(minutes) || minutes < 1) {
      customSnoozeInputRef.current?.focus();
      return;
    }
    onSnooze(Math.min(minutes, 24 * 60));
  }

  return (
    <div className="overlay-content">
      <span className="overlay-eyebrow">
        <BellIcon />
        {eyebrow}
      </span>
      <h1>{overlayMessage}</h1>
      {overlaySubtitle && <p className="overlay-title">{overlaySubtitle}</p>}
      <time>{payload.currentTime}</time>
      <strong className="overlay-elapsed">{elapsedLabel}</strong>
      <div className="overlay-primary-actions" aria-label="提醒操作">
        <button type="button" className="overlay-icon-button" aria-label="关闭提醒" onClick={onDismiss}>
          <CloseIcon />
        </button>
        <button type="button" className="overlay-icon-button" aria-label={`进入${overlayTitle}`} onClick={onEnter}>
          <ArrowUpRightIcon />
        </button>
      </div>
      <div className="overlay-snooze-actions" aria-label="稍后提醒">
        <span>稍后提醒</span>
        <button type="button" onClick={() => onSnooze(1)}>1分钟</button>
        <button type="button" onClick={() => onSnooze(5)}>5分钟</button>
        {customSnoozeOpen ? (
          <form
            className="overlay-custom-snooze"
            aria-label="自定义稍后提醒分钟数"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustomSnooze();
            }}
          >
            <input
              ref={customSnoozeInputRef}
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              value={customSnoozeDraft}
              aria-label="稍后提醒分钟数"
              onChange={(event) => setCustomSnoozeDraft(event.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onDismiss();
                }
              }}
            />
            <button type="submit">分钟</button>
          </form>
        ) : (
          <button
            type="button"
            className="overlay-more-button"
            aria-label="手动输入稍后提醒分钟数"
            onClick={() => setCustomSnoozeOpen(true)}
          >
            <MoreIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function useElapsedReminderLabel() {
  const startedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtRef.current) / 1_000));
  if (elapsedSeconds < 60) {
    return elapsedSeconds <= 0 ? '刚刚' : `${elapsedSeconds}秒前`;
  }

  return `${Math.floor(elapsedSeconds / 60)}分钟前`;
}
