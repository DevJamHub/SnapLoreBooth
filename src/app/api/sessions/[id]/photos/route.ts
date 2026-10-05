import { NextResponse } from 'next/server';
import { addPhoto, getSession, listPhotos } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';
import { InvalidImageError, saveDataUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!sessionUnlocked(id)) return NextResponse.json({ error: 'session is not paid' }, { status: 402 });
  // The sheet is printed and its QR handed out; its photos no longer change.
  if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });

  let body: { index?: unknown; dataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 1 || index > session.shots) {
    return NextResponse.json({ error: `index must be an integer between 1 and ${session.shots}` }, { status: 400 });
  }
  if (typeof body.dataUrl !== 'string') {
    return NextResponse.json({ error: 'dataUrl is required' }, { status: 400 });
  }

  try {
    const file = await saveDataUrl(id, `shot-${index}`, body.dataUrl);
    const photo = addPhoto(id, index, file);
    return NextResponse.json({ photo, photos: listPhotos(id) }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
