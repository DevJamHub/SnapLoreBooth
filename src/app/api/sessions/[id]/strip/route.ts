import { NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/db';
import { sessionUnlocked } from '@/lib/payments';
import { InvalidImageError, saveDataUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!sessionUnlocked(id)) return NextResponse.json({ error: 'session is not paid' }, { status: 402 });

  let body: { dataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (typeof body.dataUrl !== 'string') return NextResponse.json({ error: 'dataUrl is required' }, { status: 400 });

  try {
    const file = await saveDataUrl(id, 'strip', body.dataUrl);
    const session = updateSession(id, { strip_file: file, status: 'printing' });
    return NextResponse.json({ session: session ? { ...session, delivered_to: null } : null }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
