import { NextResponse } from 'next/server';
import { getSession, latestPayment } from '@/lib/db';
import { publicPayment, refreshPayment } from '@/lib/payments';
import { XenditError, isTestMode, simulateQrPayment } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

/**
 * Pays the current QR from Xendit's sandbox — the session's, or `{"purpose":"extra"}` the one for
 * extra sheets. Refused outright with a production key.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isTestMode()) return NextResponse.json({ error: 'only available with a development key' }, { status: 403 });

  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { purpose?: unknown };
  const current = latestPayment(id, body.purpose === 'extra' ? 'extra' : 'session');
  if (!current) return NextResponse.json({ error: 'no payment issued yet' }, { status: 404 });

  try {
    await simulateQrPayment(current.id, current.amount_idr);
    return NextResponse.json({ payment: publicPayment(await refreshPayment(current)) });
  } catch (error) {
    // Not 502: a Cloudflare tunnel would swap it for its own HTML page.
    if (error instanceof XenditError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
}
