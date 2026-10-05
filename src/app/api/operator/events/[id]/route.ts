import { NextResponse } from 'next/server';
import { EventDeleteError, deleteEvent } from '@/lib/retention';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware): a past event with all its sessions. The console asks first. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await deleteEvent(id));
  } catch (error) {
    if (error instanceof EventDeleteError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
