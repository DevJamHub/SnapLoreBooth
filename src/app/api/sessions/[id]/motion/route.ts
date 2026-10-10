import { NextResponse } from 'next/server';
import { getSession, listPhotos } from '@/lib/db';
import { mediaUrl } from '@/lib/format';
import { MotionError, motionFile } from '@/lib/motion';

export const dynamic = 'force-dynamic';

/**
 * Makes (once) and returns a boomerang of one photo's clip, or a GIF of the live sheet, for the
 * page the guest's QR opens. Open like that page: the session code is the key.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session?.strip_file) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  let body: { kind?: unknown; index?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  try {
    if (body.kind === 'gif') {
      if (!session.live_file) return NextResponse.json({ error: 'no live sheet' }, { status: 404 });
      const file = await motionFile(id, session.live_file, 'gif', 'sheet');
      return NextResponse.json({ url: mediaUrl(file) });
    }
    if (body.kind === 'boomerang') {
      const photo = listPhotos(id).find((p) => p.idx === Number(body.index));
      if (!photo?.clip_file) return NextResponse.json({ error: 'no clip for that photo' }, { status: 404 });
      const file = await motionFile(id, photo.clip_file, 'boomerang', `boomerang-${photo.idx}`, session.mirror);
      return NextResponse.json({ url: mediaUrl(file) });
    }
    return NextResponse.json({ error: 'kind must be gif or boomerang' }, { status: 400 });
  } catch (error) {
    // Not 502: a Cloudflare tunnel would swap it for its own HTML page.
    if (error instanceof MotionError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
