import { NextResponse } from 'next/server';
import { deleteAllContacts, deleteContact } from '@/lib/contacts';
import { PURGE_CONFIRMATION } from '@/lib/retention';

export const dynamic = 'force-dynamic';

/** `{"id"}` deletes one guest's contact; `{"all": true, "confirm": "HAPUS"}` every one (operator only). */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; all?: unknown; confirm?: unknown };
  if (body.all === true) {
    if (body.confirm !== PURGE_CONFIRMATION) return NextResponse.json({ error: `ketik ${PURGE_CONFIRMATION} untuk konfirmasi` }, { status: 400 });
    return NextResponse.json({ deleted: deleteAllContacts() });
  }
  if (typeof body.id !== 'string' || !deleteContact(body.id)) return NextResponse.json({ error: 'kontak tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ deleted: 1 });
}
