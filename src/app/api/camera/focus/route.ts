import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';
import { FocusLockError, isFocusLocked } from '@/lib/camera/focusLock';

export const dynamic = 'force-dynamic';

/**
 * `{ locked: true }` focuses once at the guests' spot and keeps that focus for every shot
 * (no AF-assist lamp, a quicker shutter); `{ locked: false }` goes back to focusing per shot.
 * Locking again refocuses. Operator-only: it moves the lens.
 */
export async function POST(request: Request) {
  const source = camera();
  if (!source?.setFocusLock) return NextResponse.json({ error: 'kamera ini tidak bisa mengunci fokus lewat USB' }, { status: 409 });

  const body = (await request.json().catch(() => null)) as { locked?: unknown } | null;
  if (typeof body?.locked !== 'boolean') return NextResponse.json({ error: 'locked harus true atau false' }, { status: 400 });

  try {
    await source.setFocusLock(body.locked);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'kamera tidak menjawab';
    return NextResponse.json({ error: message }, { status: error instanceof FocusLockError ? 409 : 503 });
  }
  return NextResponse.json({ focusLocked: isFocusLocked() });
}
