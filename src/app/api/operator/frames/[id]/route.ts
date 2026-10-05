import { NextResponse } from 'next/server';
import { FrameInputError, deleteFrame, updateFrame } from '@/lib/frames';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware): `{ name?, theme?, hidden? }`. Sheets already made keep their look. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  try {
    const frame = updateFrame(id, { name: body.name, theme: body.theme, hidden: body.hidden });
    if (!frame) return NextResponse.json({ error: 'frame tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ frame });
  } catch (error) {
    if (error instanceof FrameInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Operator-only (see middleware). Sheets already made with the frame keep it. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await deleteFrame(id))) return NextResponse.json({ error: 'frame tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ deleted: id });
}
