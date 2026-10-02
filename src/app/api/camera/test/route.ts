import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';

export const dynamic = 'force-dynamic';

const DIAGNOSTIC_FOLDER = 'diagnostics';

/**
 * Fires one frame with no guest session attached, so an operator can prove the tether and
 * measure shutter latency before doors open. Operator-only: it moves real hardware.
 */
export async function POST() {
  const source = camera();
  if (!source) return NextResponse.json({ error: 'this booth captures in the browser' }, { status: 409 });

  const started = Date.now();
  try {
    const result = await source.capture(DIAGNOSTIC_FOLDER, 1);
    return NextResponse.json({ file: result.file, bytes: result.bytes, ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'capture failed';
    return NextResponse.json({ error: message, ms: Date.now() - started }, { status: 502 });
  }
}
