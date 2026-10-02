import { NextResponse } from 'next/server';
import { deleteFrame } from '@/lib/frames';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware). Sheets already made with the frame keep it. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await deleteFrame(id))) return NextResponse.json({ error: 'frame tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
