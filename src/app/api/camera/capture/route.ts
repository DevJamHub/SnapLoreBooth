import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';
import { addPhoto, getSession, listPhotos } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';
import { mirrorFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const source = camera();
  if (!source) return NextResponse.json({ error: 'this booth captures in the browser' }, { status: 409 });

  let body: { sessionId?: unknown; index?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const sessionId = String(body.sessionId ?? '');
  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!sessionUnlocked(sessionId)) return NextResponse.json({ error: 'session is not paid' }, { status: 402 });

  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 1 || index > session.shots) {
    return NextResponse.json({ error: `index must be an integer between 1 and ${session.shots}` }, { status: 400 });
  }

  try {
    const result = await source.capture(sessionId, index);
    // Tethered stills land on disk straight from the camera, so they are copied off-site here.
    await mirrorFile(result.file);
    const photo = addPhoto(sessionId, index, result.file);
    return NextResponse.json({ photo, bytes: result.bytes, photos: listPhotos(sessionId) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'capture failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
