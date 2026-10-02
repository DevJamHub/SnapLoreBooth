import { NextResponse } from 'next/server';
import { PURGE_CONFIRMATION, purgeAllSessions } from '@/lib/retention';

export const dynamic = 'force-dynamic';

/**
 * Operator-only (see middleware): deletes every guest's photos, videos and session record.
 * The console makes the operator type the confirmation word; the API checks it again so a
 * stray request can never wipe the booth.
 */
export async function DELETE(request: Request) {
  let body: { confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (body.confirm !== PURGE_CONFIRMATION) {
    return NextResponse.json({ error: `ketik ${PURGE_CONFIRMATION} untuk konfirmasi` }, { status: 400 });
  }
  return NextResponse.json(await purgeAllSessions());
}
