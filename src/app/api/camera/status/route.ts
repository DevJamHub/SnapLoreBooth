import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware): the body's settings, for the calibration checklist. */
export async function GET() {
  const source = camera();
  if (!source?.status) return NextResponse.json({ error: 'no external camera on this booth' }, { status: 409 });
  try {
    return NextResponse.json({ status: await source.status() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message.split('\n')[0] : 'camera did not answer' }, { status: 409 });
  }
}
