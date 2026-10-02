import { NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';
import { InvalidImageError, MAX_VIDEO_BYTES, saveVideo } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Stores the live sheet video the booth composes from the shots' clips. Raw MP4/WebM body. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!sessionUnlocked(id)) return NextResponse.json({ error: 'session is not paid' }, { status: 402 });
  if (!session.strip_file) return NextResponse.json({ error: 'finish the sheet first' }, { status: 409 });

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_VIDEO_BYTES) return NextResponse.json({ error: 'video exceeds 15MB' }, { status: 413 });

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const file = await saveVideo(id, 'live', request.headers.get('content-type') ?? '', bytes);
    updateSession(id, { live_file: file });
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
