import { NextResponse } from 'next/server';
import { setInGallery } from '@/lib/db';
import { BULK_CONFIRM_FROM, PURGE_CONFIRMATION, SESSION_ID, deleteSessions, purgeAllSessions } from '@/lib/retention';

export const dynamic = 'force-dynamic';

const MAX_IDS = 500;

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The chosen session ids, or null when the list is missing, empty, too long or malformed. */
function sessionIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_IDS) return null;
  return raw.every((id) => typeof id === 'string' && SESSION_ID.test(id)) ? (raw as string[]) : null;
}

/**
 * Operator-only (see middleware). `{ ids, includeActive? }` deletes the chosen sessions;
 * `{ confirm: 'HAPUS' }` deletes every guest's. The console asks first; the API checks the
 * typed word again for the big deletes, so a stray request can never wipe the booth.
 */
export async function DELETE(request: Request) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });

  if (body.ids !== undefined) {
    const ids = sessionIds(body.ids);
    if (!ids) return NextResponse.json({ error: `pilih 1–${MAX_IDS} sesi` }, { status: 400 });
    if (ids.length >= BULK_CONFIRM_FROM && body.confirm !== PURGE_CONFIRMATION) {
      return NextResponse.json({ error: `ketik ${PURGE_CONFIRMATION} untuk menghapus ${ids.length} sesi` }, { status: 400 });
    }
    return NextResponse.json(await deleteSessions(ids, body.includeActive === true));
  }

  if (body.confirm !== PURGE_CONFIRMATION) {
    return NextResponse.json({ error: `ketik ${PURGE_CONFIRMATION} untuk konfirmasi` }, { status: 400 });
  }
  return NextResponse.json(await purgeAllSessions());
}

/** Operator-only: `{ ids, in_gallery }` shows or hides the chosen sessions in the event gallery. */
export async function PATCH(request: Request) {
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  const ids = sessionIds(body.ids);
  if (!ids) return NextResponse.json({ error: `pilih 1–${MAX_IDS} sesi` }, { status: 400 });
  if (typeof body.in_gallery !== 'boolean') return NextResponse.json({ error: 'in_gallery must be a boolean' }, { status: 400 });
  return NextResponse.json({ updated: setInGallery(ids, body.in_gallery) });
}
