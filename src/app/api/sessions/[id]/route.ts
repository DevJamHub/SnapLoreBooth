import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { discardSession, getSession, listPhotos, updateSession } from '@/lib/db';
import { BACKGROUNDS, NO_BACKGROUND } from '@/lib/backgrounds';
import { DecorInputError, parseDecor } from '@/lib/decor';
import { frameById, frameForSession } from '@/lib/frames';
import { BEAUTY, FILTERS, TEMPLATES } from '@/lib/packages';
import { validPicks } from '@/lib/picks';
import { boardLayout } from '@/lib/layout';
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
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

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
  const { style } = getConfig();
  if (body.filter !== undefined) {
    if (!FILTERS.some((f) => f.id === body.filter)) return NextResponse.json({ error: 'unknown filter' }, { status: 400 });
    if (!style.filters.includes(String(body.filter))) return NextResponse.json({ error: 'filter is switched off' }, { status: 400 });
    patch.filter = String(body.filter);
  }
  if (body.template !== undefined) {
    const templateId = String(body.template);
    // A built-in frame fits every package; an uploaded one only the package it was drawn for.
    const frame = frameById(templateId);
    const known = TEMPLATES.some((t) => t.id === templateId) || (frame?.format === session.format && !frame.hidden);
    if (!known) return NextResponse.json({ error: 'unknown template' }, { status: 400 });
    patch.template = templateId;
  }
  if (body.beauty !== undefined) {
    if (!BEAUTY.some((b) => b.id === body.beauty)) return NextResponse.json({ error: 'unknown beauty level' }, { status: 400 });
    if (!style.beauty && body.beauty !== 'off') return NextResponse.json({ error: 'beauty is switched off' }, { status: 400 });
    patch.beauty = String(body.beauty);
  }
  if (body.mirror !== undefined) {
    if (typeof body.mirror !== 'boolean') return NextResponse.json({ error: 'mirror must be a boolean' }, { status: 400 });
    // The printed sheet is final; flipping now would make the QR page disagree with the paper.
    if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });
    patch.mirror = body.mirror;
  }
  if (body.decor !== undefined) {
    if (!style.decor && body.decor !== null && !(Array.isArray(body.decor) && body.decor.length === 0)) {
      return NextResponse.json({ error: 'stickers are switched off' }, { status: 400 });
    }
    // Like the mirror: once the sheet is made, the print is what the QR page must show.
    if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });
    try {
      const layout = boardLayout(session.format, session.template, session.shots, frameForSession(session));
      patch.decor = parseDecor(body.decor, layout);
    } catch (error) {
      if (error instanceof DecorInputError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  if (body.background !== undefined) {
    const id = String(body.background);
    if (id !== NO_BACKGROUND && !BACKGROUNDS.some((b) => b.id === id)) return NextResponse.json({ error: 'unknown background' }, { status: 400 });
    if (!style.backgrounds && id !== NO_BACKGROUND) return NextResponse.json({ error: 'backgrounds are switched off' }, { status: 400 });
    if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });
    patch.background = id;
  }
  if (body.picks !== undefined) {
    // Like the decorations: the photos on a made sheet are what the QR page must show.
    if (session.strip_file) return NextResponse.json({ error: 'sheet already made' }, { status: 409 });
    const picks = validPicks(body.picks, session, new Set(listPhotos(id).map((p) => p.idx)));
    if (!picks) return NextResponse.json({ error: `picks must be ${session.shots} different photos that were shot` }, { status: 400 });
    patch.picks = picks;
  }
  if (body.in_gallery !== undefined) {
    if (typeof body.in_gallery !== 'boolean') return NextResponse.json({ error: 'in_gallery must be a boolean' }, { status: 400 });
    patch.in_gallery = body.in_gallery;
  }
  // The print count is fixed by what was paid for; the kiosk cannot raise it.

  const updated = updateSession(id, patch);
  return NextResponse.json({ session: updated ? { ...updated, delivered_to: null } : null });
}

/** The guest went back to change package before paying or shooting; an empty session goes. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!discardSession(id)) return NextResponse.json({ error: 'session has photos or a payment; it stays' }, { status: 409 });
  return NextResponse.json({ discarded: id });
}
