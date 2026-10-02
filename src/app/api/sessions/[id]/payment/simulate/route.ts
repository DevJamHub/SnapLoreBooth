import { NextResponse } from 'next/server';
import { getSession, latestPayment } from '@/lib/db';
import { publicPayment, refreshPayment } from '@/lib/payments';
import { XenditError, isTestMode, simulateQrPayment } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

/** Pays the current QR from Xendit's sandbox. Refused outright with a production key. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isTestMode()) return NextResponse.json({ error: 'only available with a development key' }, { status: 403 });

  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  const current = latestPayment(id);
  if (!current) return NextResponse.json({ error: 'no payment issued yet' }, { status: 404 });

  try {
    await simulateQrPayment(current.id, current.amount_idr);
    return NextResponse.json({ payment: publicPayment(await refreshPayment(current)) });
  } catch (error) {
    if (error instanceof XenditError) return NextResponse.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
