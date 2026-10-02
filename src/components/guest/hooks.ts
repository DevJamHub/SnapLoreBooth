'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Calls onIdle after `ms` without a touch. Pass null to pause (e.g. while a guest is paying on their phone). */
export function useIdle(ms: number | null, onIdle: () => void) {
  const callback = useRef(onIdle);
  callback.current = onIdle;

  useEffect(() => {
    if (ms === null) return;
    let timer = setTimeout(() => callback.current(), ms);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), ms);
    };
    window.addEventListener('pointerdown', reset, { passive: true });
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [ms]);
}

/** Counts down once per second from `seconds` while `running`; returns what is left. */
export function useCountdown(seconds: number, running: boolean, onDone: () => void): number {
  const [left, setLeft] = useState(seconds);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    setLeft(seconds);
    if (!running) return;
    // Counted outside the state updater: React may run updaters twice, and onDone must fire once.
    let n = seconds;
    const timer = setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) {
        clearInterval(timer);
        done.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds, running]);

  return left;
}

/** A press held for `ms` — the hidden way into the operator console. */
export function useLongPress(ms: number, onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    cancel();
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onLongPress();
    }, ms);
  }, [cancel, ms, onLongPress]);

  useEffect(() => cancel, [cancel]);

  return {
    holding,
    handlers: { onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel },
  };
}

export function formatClock(seconds: number): string {
  const s = Math.max(Math.floor(seconds), 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
