import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';
import type { CameraSettings } from '@/lib/camera/types';

export const dynamic = 'force-dynamic';

const ALLOWED: (keyof CameraSettings)[] = ['iso', 'aperture', 'shutterspeed'];

export async function POST(request: Request) {
  const source = camera();
  if (!source) return NextResponse.json({ error: 'this booth captures in the browser' }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const patch: Partial<CameraSettings> = {};
  for (const key of ALLOWED) {
    if (body[key] !== undefined) patch[key] = String(body[key]);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: `provide at least one of ${ALLOWED.join(', ')}` }, { status: 400 });
  }

  try {
    return NextResponse.json({ settings: await source.applySettings(patch) });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'could not apply settings';
    // 409, not 502: a Cloudflare tunnel swaps an origin's 502 for its own HTML page, and the
    // reason (the camera could not focus) would never reach the screen.
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
