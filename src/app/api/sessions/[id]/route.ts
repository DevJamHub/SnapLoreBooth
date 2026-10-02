import { NextResponse } from 'next/server';
import { getSession, listPhotos, updateSession } from '@/lib/db';
import { FILTERS, TEMPLATES } from '@/lib/packages';
import type { SessionStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES: SessionStatus[] = ['capturing', 'reviewing', 'ready', 'printing', 'done'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  // Anyone holding the QR link knows the id, so contact details stay operator-only.
  return NextResponse.json({ session: { ...session, delivered_to: null }, photos: listPhotos(id) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const patch: Parameters<typeof updateSession>[1] = {};

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as SessionStatus)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
    }
    patch.status = body.status as SessionStatus;
  }
  if (body.filter !== undefined) {
    if (!FILTERS.some((f) => f.id === body.filter)) return NextResponse.json({ error: 'unknown filter' }, { status: 400 });
    patch.filter = String(body.filter);
  }
  if (body.template !== undefined) {
    if (!TEMPLATES.some((t) => t.id === body.template)) return NextResponse.json({ error: 'unknown template' }, { status: 400 });
    patch.template = String(body.template);
  }
  // The print count is fixed by what was paid for; the kiosk cannot raise it.

  const updated = updateSession(id, patch);
  return NextResponse.json({ session: updated ? { ...updated, delivered_to: null } : null });
}
