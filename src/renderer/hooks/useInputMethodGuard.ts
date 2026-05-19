import { useEffect, useRef } from 'react';

export function isInputMethodComposing(event: React.KeyboardEvent<HTMLElement>) {
  return event.nativeEvent.isComposing;
}

export function useInputMethodGuard() {
  const isComposingRef = useRef(false);
  const justFinishedComposingRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  function clearResetTimer() {
    if (resetTimerRef.current === null) {
      return;
    }
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }

  function markCompositionStart() {
    clearResetTimer();
    isComposingRef.current = true;
    justFinishedComposingRef.current = false;
  }

  function markCompositionEnd() {
    clearResetTimer();
    isComposingRef.current = false;
    justFinishedComposingRef.current = true;
    // 只兜住少数环境里 compositionend 先于 Enter keydown 的同一轮事件，避免误吃用户下一次保存。
    resetTimerRef.current = window.setTimeout(() => {
      justFinishedComposingRef.current = false;
      resetTimerRef.current = null;
    }, 0);
  }

  function shouldIgnoreEnter(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter') {
      return false;
    }

    const isComposing = isInputMethodComposing(event) || isComposingRef.current;
    const justFinishedComposing = justFinishedComposingRef.current;

    if (!isComposing && !justFinishedComposing) {
      return false;
    }

    isComposingRef.current = false;
    justFinishedComposingRef.current = false;
    return true;
  }

  return {
    markCompositionStart,
    markCompositionEnd,
    shouldIgnoreEnter
  };
}
