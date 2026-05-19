import { useEffect, useRef, useState } from 'react';
import {
  formatDateInputValue,
  formatTimeInputValue,
  isTimeDraftReadyToCommit,
  limitDateDraft,
  limitTimeDraft,
  normalizeDateInput,
  normalizeTimeInput
} from '../domain/dateTimeInput';
import { useInputMethodGuard } from '../hooks/useInputMethodGuard';

type TimeFieldProps = {
  value: string;
  placeholder?: string;
  allowEmpty?: boolean;
  commitOnValidChange?: boolean;
  onChange: (value: string) => void | Promise<void>;
  onKeyboardCommit?: (value: string) => void | Promise<void>;
};

type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyboardCommit?: () => void;
};

export function DateField(props: DateFieldProps) {
  const { value, onChange, onKeyboardCommit } = props;
  const [draft, setDraft] = useState(formatDateInputValue(value));
  const lastCommittedRef = useRef(value);
  const inputMethodGuard = useInputMethodGuard();
  const placeholder = formatDateInputValue(lastCommittedRef.current);

  useEffect(() => {
    setDraft(formatDateInputValue(value));
    lastCommittedRef.current = value;
  }, [value]);

  function commitNormalizedDate(normalizedDate: string) {
    setDraft(formatDateInputValue(normalizedDate));
    if (normalizedDate === lastCommittedRef.current) {
      return;
    }
    lastCommittedRef.current = normalizedDate;
    onChange(normalizedDate);
  }

  function commit(nextDraft: string) {
    if (!nextDraft.trim()) {
      setDraft(formatDateInputValue(lastCommittedRef.current));
      return false;
    }

    const normalizedDate = normalizeDateInput(nextDraft);
    if (!normalizedDate) {
      setDraft(formatDateInputValue(lastCommittedRef.current));
      return false;
    }

    commitNormalizedDate(normalizedDate);
    return true;
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(limitDateDraft(event.target.value))}
      onBlur={() => commit(draft)}
      onCompositionStart={inputMethodGuard.markCompositionStart}
      onCompositionEnd={inputMethodGuard.markCompositionEnd}
      onKeyDown={(event) => {
        if (inputMethodGuard.shouldIgnoreEnter(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          commit(draft);
          onKeyboardCommit?.();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function TimeField(props: TimeFieldProps) {
  const { value, placeholder, allowEmpty = false, commitOnValidChange = false, onChange, onKeyboardCommit } = props;
  const [draft, setDraft] = useState(formatTimeInputValue(value));
  const lastCommittedRef = useRef(formatTimeInputValue(value));
  const keyboardCommitPendingRef = useRef(false);
  const inputMethodGuard = useInputMethodGuard();
  const placeholderText = formatTimeInputValue(placeholder ?? lastCommittedRef.current);

  useEffect(() => {
    const formattedValue = formatTimeInputValue(value);
    setDraft(formattedValue);
    lastCommittedRef.current = formattedValue;
  }, [value]);

  async function commitNormalizedTime(normalizedTime: string) {
    setDraft(normalizedTime);
    if (normalizedTime === lastCommittedRef.current) {
      return normalizedTime;
    }
    lastCommittedRef.current = normalizedTime;
    await onChange(normalizedTime);
    return normalizedTime;
  }

  async function commit(nextDraft: string) {
    if (!nextDraft.trim()) {
      setDraft(lastCommittedRef.current);
      return null;
    }

    const normalizedTime = normalizeTimeInput(nextDraft);
    if (!normalizedTime) {
      setDraft(lastCommittedRef.current);
      return null;
    }

    return commitNormalizedTime(normalizedTime);
  }

  function updateDraft(nextValue: string) {
    const nextDraft = limitTimeDraft(nextValue);
    setDraft(nextDraft);

    if (!commitOnValidChange) {
      return;
    }

    if (!nextDraft.trim()) {
      if (allowEmpty) {
        void commitNormalizedTime('');
      }
      return;
    }

    const normalizedTime = normalizeTimeInput(nextDraft);
    if (normalizedTime && isTimeDraftReadyToCommit(nextDraft)) {
      void commitNormalizedTime(normalizedTime);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholderText}
      value={draft}
      onChange={(event) => updateDraft(event.target.value)}
      onBlur={() => void commit(draft)}
      onCompositionStart={inputMethodGuard.markCompositionStart}
      onCompositionEnd={inputMethodGuard.markCompositionEnd}
      onKeyDown={(event) => {
        if (inputMethodGuard.shouldIgnoreEnter(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (keyboardCommitPendingRef.current) {
            return;
          }
          keyboardCommitPendingRef.current = true;
          const shouldNotifyKeyboardCommit = event.key === 'Enter' || event.key === 'Escape';
          void commit(draft).then((committedValue) => {
            if (shouldNotifyKeyboardCommit && committedValue) {
              return onKeyboardCommit?.(committedValue);
            }
            return undefined;
          }).finally(() => {
            keyboardCommitPendingRef.current = false;
          });
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type RollingCountdownProps = {
  value: string;
};

export function RollingCountdown(props: RollingCountdownProps) {
  const { value } = props;
  const shouldAnimateDigits = /^\d{2}:\d{2}:\d{2}$/.test(value);

  if (!shouldAnimateDigits) {
    return <strong className="rolling-countdown">{value}</strong>;
  }

  return (
    <strong className="rolling-countdown" aria-label={value}>
      {value.split('').map((char, index) => (
        <span className={/\d/.test(char) ? 'rolling-digit-frame' : 'rolling-static-char'} key={`${index}-${char}`}>
          <span className={/\d/.test(char) ? 'rolling-digit' : ''}>{char}</span>
        </span>
      ))}
    </strong>
  );
}
