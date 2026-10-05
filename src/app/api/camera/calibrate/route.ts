import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';

export const dynamic = 'force-dynamic';

/**
 * Operator-only (see middleware): sets the external camera up for the booth over USB and
 * reports each setting it found and what it did. It changes the body, so it is never public.
 */
export async function POST() {
  const source = camera();
  if (!source?.autoSetup) return NextResponse.json({ error: 'no external camera on this booth' }, { status: 409 });
  try {
    return NextResponse.json({ steps: await source.autoSetup() });
  } catch (error) {
    // 409, not 502: a tunnel would replace a 502 with its own page.
    return NextResponse.json({ error: error instanceof Error ? error.message.split('\n')[0] : 'camera did not answer' }, { status: 409 });
  }
}
