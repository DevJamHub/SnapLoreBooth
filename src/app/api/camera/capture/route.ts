import { NextResponse } from 'next/server';
import { camera } from '@/lib/camera';
import { getConfig } from '@/lib/config';
import { addPhoto, getSession, listPhotos } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';
import { mirrorFile, optimizeStill } from '@/lib/storage';
import { shotCount } from '@/lib/picks';

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
  if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });

  const index = Number(body.index);
  // The sheet's photos and any bonus ones to pick from.
  if (!Number.isInteger(index) || index < 1 || index > shotCount(session)) {
    return NextResponse.json({ error: `index must be an integer between 1 and ${shotCount(session)}` }, { status: 400 });
  }

  // The reply is a short event stream: "fired" the moment the shutter goes, so the kiosk can
  // flash then rather than when it asked, and "done" (or "error") once the photo is stored.
  // Errors travel in the stream with a 200: the headers are already sent by then.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The kiosk went away; the photo is still stored below.
        }
      };
      try {
        const result = await source.capture(sessionId, index, () => send({ type: 'fired' }));
        // A camera's full-size file is several MB: kept at the configured size, it loads on the
        // kiosk faster and takes a fraction of the disk.
        const { maxEdge, quality } = getConfig().storage;
        await optimizeStill(result.file, maxEdge, quality);
        // Tethered stills land on disk straight from the camera, so they are copied off-site here.
        void mirrorFile(result.file);
        const photo = addPhoto(sessionId, index, result.file);
        send({ type: 'done', photo, bytes: result.bytes, photos: listPhotos(sessionId) });
      } catch (error) {
        send({ type: 'error', error: error instanceof Error ? error.message.split('\n')[0] : 'capture failed' });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      // Event streams pass through Cloudflare tunnels unbuffered.
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
