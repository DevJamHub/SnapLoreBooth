import { NextResponse } from 'next/server';
import { deleteVoucher, setVoucherActive } from '@/lib/vouchers';

export const dynamic = 'force-dynamic';

/** Switches a code on or off; off keeps it (and its count) without letting guests use it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let body: { active?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 });
  const voucher = setVoucherActive(code, body.active);
  if (!voucher) return NextResponse.json({ error: 'kode tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ voucher });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!deleteVoucher(code)) return NextResponse.json({ error: 'kode tidak ditemukan' }, { status: 404 });
  return NextResponse.json({ deleted: code });
}
