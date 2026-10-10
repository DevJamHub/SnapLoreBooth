import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { ContactInputError, saveContact } from '@/lib/contacts';
import { getSession } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** A guest leaves their contact on the page the QR opens: `{name, phone?, instagram?, answer?, consent: true}`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  const { share } = getConfig();
  if (!share.contacts) return NextResponse.json({ error: 'contacts are switched off' }, { status: 409 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  try {
    saveContact(session, body, share.question ? share.answers : []);
    return NextResponse.json({ saved: true }, { status: 201 });
  } catch (error) {
    if (error instanceof ContactInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
