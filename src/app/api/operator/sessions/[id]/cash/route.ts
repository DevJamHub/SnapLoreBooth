import { NextResponse } from 'next/server';
import { getSession, isSessionPaid, recordCashPayment } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Operator-only (see middleware): the guest paid in cash. The booth screen waiting on the QR
 * sees the session paid on its next poll and moves on to the photos. The console asks first.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'sesi tidak ditemukan' }, { status: 404 });
  if (!session.requires_payment) return NextResponse.json({ error: 'sesi ini gratis' }, { status: 409 });
  if (isSessionPaid(id)) return NextResponse.json({ error: 'sesi ini sudah lunas' }, { status: 409 });
  return NextResponse.json({ payment: recordCashPayment(id, session.price_idr) }, { status: 201 });
}
