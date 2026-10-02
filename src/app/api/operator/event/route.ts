import { NextResponse } from 'next/server';
import { EventInputError, currentEvent, startEvent, updateEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

/** Operator-only (see middleware): edit the running event. */
export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  try {
    return NextResponse.json({ event: updateEvent(currentEvent().id, body) });
  } catch (error) {
    if (error instanceof EventInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Starts a new event; new guests join it, and it gets its own gallery link. */
export async function POST(request: Request) {
  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name) return NextResponse.json({ error: 'nama acara wajib diisi' }, { status: 400 });
  return NextResponse.json({ event: startEvent({ name }) }, { status: 201 });
}
