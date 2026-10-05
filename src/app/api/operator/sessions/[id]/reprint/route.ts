import { NextResponse } from 'next/server';
import { addReprints, getSession } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_COPIES = 10;

/** Operator-only (see middleware): records sheets printed again, so the paper count stays true. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session?.strip_file) return NextResponse.json({ error: 'sesi belum punya lembar jadi' }, { status: 404 });
  let copies = 1;
  try {
    copies = Number(((await request.json()) as { copies?: unknown }).copies ?? 1);
  } catch {
    // No body: one copy.
  }
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    return NextResponse.json({ error: `jumlah cetak 1–${MAX_COPIES}` }, { status: 400 });
  }
  addReprints(id, copies);
  return NextResponse.json({ reprinted: copies });
}
