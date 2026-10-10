import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { getSession } from '@/lib/db';
import { eraseSessionMedia } from '@/lib/retention';

export const dynamic = 'force-dynamic';

/**
 * "Hapus fotoku": the guest deletes their own photos and videos now rather than when the booth
 * forgets them. Whoever holds the QR link holds the photos, so the link is the key here too.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!getConfig().share.erase) return NextResponse.json({ error: 'erasing is switched off' }, { status: 409 });
  const body = (await request.json().catch(() => ({}))) as { confirm?: unknown };
  if (body.confirm !== true) return NextResponse.json({ error: 'confirm must be true' }, { status: 400 });
  if (session.erased_at) return NextResponse.json({ erased: true });
  if (!(await eraseSessionMedia(id))) return NextResponse.json({ error: 'Belum bisa dihapus semuanya. Coba lagi sebentar.' }, { status: 503 });
  return NextResponse.json({ erased: true });
}
