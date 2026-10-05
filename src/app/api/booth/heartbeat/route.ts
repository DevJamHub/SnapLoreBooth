import { NextResponse } from 'next/server';
import { recordBeat } from '@/lib/heartbeat';

export const dynamic = 'force-dynamic';

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/** A booth screen saying it is alive and where it is. Open: the kiosk has no login. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const id = text(body.id, 40);
  if (!/^[a-z0-9-]{8,40}$/i.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const battery = Number(body.battery);
  recordBeat({
    id,
    device: text(body.device, 30) || 'Perangkat',
    page: text(body.page, 30) || '?',
    session: /^SB[A-Z0-9]{6}$/.test(String(body.session)) ? String(body.session) : null,
    camera: text(body.camera, 30),
    screen: text(body.screen, 20),
    battery: Number.isFinite(battery) && battery >= 0 && battery <= 100 ? Math.round(battery) : null,
    charging: typeof body.charging === 'boolean' ? body.charging : null,
    seenAt: Date.now(),
  });
  return new NextResponse(null, { status: 204 });
}
