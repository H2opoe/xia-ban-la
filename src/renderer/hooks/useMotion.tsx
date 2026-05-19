import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MENU_PANEL_ANIMATION_MS } from '../../shared/window';

export type PresencePhase = 'enter' | 'exit';
export type ListPresencePhase = PresencePhase | 'idle';

type PresenceState<T> = {
  value: T | null;
  phase: PresencePhase;
};

type AnimatedListItem<T> = {
  key: string;
  item: T;
  phase: ListPresencePhase;
};

export function Presence(props: { visible: boolean; children: (phase: PresencePhase) => React.ReactNode }) {
  const { visible, children } = props;
  const state = usePresenceValue(visible ? true : null);

  if (!state.value) {
    return null;
  }

  return <>{children(state.phase)}</>;
}

function usePresenceValue<T>(value: T | null, durationMs = MENU_PANEL_ANIMATION_MS): PresenceState<T> {
  const [state, setState] = useState<PresenceState<T>>({
    value,
    phase: 'enter'
  });

  useEffect(() => {
    if (value) {
      setState({ value, phase: 'enter' });
      return undefined;
    }

    if (!state.value) {
      return undefined;
    }

    setState((current) => (current.value ? { ...current, phase: 'exit' } : current));
    const timer = window.setTimeout(() => {
      setState((current) => (current.phase === 'exit' ? { value: null, phase: 'enter' } : current));
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [durationMs, state.value, value]);

  return state;
}

export function useAnimatedList<T>(
  items: T[],
  getKey: (item: T) => string,
  durationMs = MENU_PANEL_ANIMATION_MS
): AnimatedListItem<T>[] {
  const [animatedItems, setAnimatedItems] = useState<AnimatedListItem<T>[]>(() =>
    items.map((item) => ({
      key: getKey(item),
      item,
      phase: 'enter'
    }))
  );

  useEffect(() => {
    setAnimatedItems((currentItems) => {
      const nextItemsByKey = new Map(items.map((item) => [getKey(item), item]));
      const currentItemsByKey = new Map(currentItems.map((item) => [item.key, item]));
      const enteringItems: AnimatedListItem<T>[] = items.map((item) => {
        const key = getKey(item);
        const currentPhase = currentItemsByKey.get(key)?.phase;
        return {
          key,
          item,
          phase: currentPhase === 'exit' ? 'enter' : (currentPhase || 'enter')
        };
      });
      const nextAnimatedItems = [...enteringItems];

      currentItems.forEach((currentItem, index) => {
        if (nextItemsByKey.has(currentItem.key)) {
          return;
        }

        nextAnimatedItems.splice(Math.min(index, nextAnimatedItems.length), 0, {
          ...currentItem,
          phase: 'exit'
        });
      });

      return nextAnimatedItems;
    });
  }, [getKey, items]);

  useEffect(() => {
    if (!animatedItems.some((item) => item.phase === 'exit')) {
      return undefined;
    }

    const sourceKeys = new Set(items.map((item) => getKey(item)));
    const timer = window.setTimeout(() => {
      setAnimatedItems((currentItems) => currentItems.filter((item) => item.phase !== 'exit' || sourceKeys.has(item.key)));
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [animatedItems, durationMs, getKey, items]);

  useEffect(() => {
    if (!animatedItems.some((item) => item.phase === 'enter')) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setAnimatedItems((currentItems) =>
        currentItems.map((item) => (item.phase === 'enter' ? { ...item, phase: 'idle' } : item))
      );
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [animatedItems, durationMs]);

  return animatedItems;
}

export function useListReorderMotion<T>(
  items: T[],
  getKey: (item: T) => string,
  durationMs: number
) {
  const elementRefs = useRef(new Map<string, HTMLElement>());
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const previousOrderRef = useRef<string[]>([]);
  const activeAnimationsRef = useRef(new Map<string, Animation>());
  const orderSignature = items.map((item) => getKey(item)).join('|');

  useLayoutEffect(() => {
    const previousOrder = previousOrderRef.current;
    const nextOrder = items.map((item) => getKey(item));
    const shouldAnimateReorder = hasSameKeys(previousOrder, nextOrder) && previousOrder.join('|') !== orderSignature;
    const nextRects = new Map<string, DOMRect>();

    items.forEach((item) => {
      const key = getKey(item);
      const element = elementRefs.current.get(key);
      if (!element) {
        return;
      }

      const nextRect = element.getBoundingClientRect();
      const previousRect = previousRectsRef.current.get(key);
      nextRects.set(key, nextRect);

      if (!shouldAnimateReorder || !previousRect) {
        return;
      }

      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) {
        return;
      }

      // 完成提醒会触发排序变化，用 FLIP 位移动画承接旧位置到新位置，避免列表硬切。
      activeAnimationsRef.current.get(key)?.cancel();
      element.classList.add('reminder-menu-item-reordering');
      const animation = element.animate([
        { transform: `translateY(${deltaY}px)` },
        { transform: 'translateY(0)' }
      ], {
        duration: durationMs,
        easing: 'cubic-bezier(0.2, 0.85, 0.2, 1)'
      });

      activeAnimationsRef.current.set(key, animation);
      animation.addEventListener('finish', () => {
        if (activeAnimationsRef.current.get(key) !== animation) {
          return;
        }
        activeAnimationsRef.current.delete(key);
        element.classList.remove('reminder-menu-item-reordering');
      }, { once: true });
      animation.addEventListener('cancel', () => {
        if (activeAnimationsRef.current.get(key) === animation) {
          activeAnimationsRef.current.delete(key);
        }
        element.classList.remove('reminder-menu-item-reordering');
      }, { once: true });
    });

    previousRectsRef.current = nextRects;
    previousOrderRef.current = nextOrder;
  }, [durationMs, getKey, items, orderSignature]);

  return useCallback((key: string, element: HTMLElement | null) => {
    if (!element) {
      activeAnimationsRef.current.get(key)?.cancel();
      activeAnimationsRef.current.delete(key);
      elementRefs.current.delete(key);
      return;
    }
    elementRefs.current.set(key, element);
  }, []);
}

export function getMotionClassName(className: string, phase: PresencePhase, extraClassName?: string) {
  return [className, extraClassName, 'motion-presence', `motion-${phase}`].filter(Boolean).join(' ');
}

export function getListMotionClassName(className: string, phase: ListPresencePhase, extraClassName?: string) {
  if (phase === 'idle') {
    return [className, extraClassName].filter(Boolean).join(' ');
  }

  return getMotionClassName(className, phase, extraClassName);
}

function hasSameKeys(first: string[], second: string[]) {
  if (first.length === 0 || first.length !== second.length) {
    return false;
  }

  const firstKeys = new Set(first);
  return second.every((key) => firstKeys.has(key));
}
