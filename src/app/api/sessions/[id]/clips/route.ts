import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { getSession, setClip } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';
import { InvalidImageError, MAX_VIDEO_BYTES, saveVideo } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Stores the few seconds recorded during a shot's countdown — the booth's "live photo".
 * The body is the raw recording; `?index=` names the shot it belongs to, which must already
 * have its still.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!sessionUnlocked(id)) return NextResponse.json({ error: 'session is not paid' }, { status: 402 });
  // The sheet is printed and its QR handed out; its photos no longer change.
  if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });

  if (!getConfig().capture.clips) return NextResponse.json({ error: 'video is switched off' }, { status: 409 });

  const index = Number(new URL(request.url).searchParams.get('index'));
  if (!Number.isInteger(index) || index < 1 || index > session.shots) {
    return NextResponse.json({ error: `index must be an integer between 1 and ${session.shots}` }, { status: 400 });
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_VIDEO_BYTES) return NextResponse.json({ error: 'video exceeds 15MB' }, { status: 413 });

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const file = await saveVideo(id, `clip-${index}`, request.headers.get('content-type') ?? '', bytes);
    if (!setClip(id, index, file)) return NextResponse.json({ error: 'upload the still for this shot first' }, { status: 409 });
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
