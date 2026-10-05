import { getSetting, setSetting } from '@/lib/db';

const KEY = 'camera.focusLock';

/**
 * Whether the external camera keeps one focus for every shot instead of focusing per shot.
 * Locked, a shot never autofocuses: no AF-assist lamp (the red light in a dim room) and a
 * quicker shutter. Kept in the database so it survives a restart, like the body's own focus.
 */
export function isFocusLocked(): boolean {
  return getSetting(KEY) === '1';
}

export function saveFocusLock(locked: boolean) {
  setSetting(KEY, locked ? '1' : null);
}

export class FocusLockError extends Error {}
