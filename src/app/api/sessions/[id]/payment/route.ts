import { NextResponse } from 'next/server';
import { getSession, latestPayment } from '@/lib/db';
import { ensurePayment, publicPayment, refreshPayment, sessionUnlocked } from '@/lib/payments';
import { XenditError, isTestMode } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  if (error instanceof XenditError) {
    // 503 rather than 502 for a failing Xendit: a Cloudflare tunnel replaces an origin's 502 with
    // its own HTML page, which the kiosk cannot read.
    return NextResponse.json({ error: error.message }, { status: error.status >= 500 ? 503 : error.status });
  }
  throw error;
}

/** Issues the session's QRIS code, or returns the one still live. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!session.requires_payment || (sessionUnlocked(id) && !latestPayment(id))) {
    return NextResponse.json({ payment: null, required: false });
  }

  try {
    const payment = await ensurePayment(session);
    return NextResponse.json({ payment: publicPayment(payment), required: true, testMode: isTestMode() });
  } catch (error) {
    return failure(error);
  }
}

/** What the payment screen polls: settles from Xendit when the webhook cannot reach us. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  if (!session.requires_payment) return NextResponse.json({ payment: null, required: false });

  const current = latestPayment(id);
  if (!current) return NextResponse.json({ error: 'no payment issued yet' }, { status: 404 });

  try {
    const payment = await refreshPayment(current);
    return NextResponse.json({ payment: publicPayment(payment), required: true, testMode: isTestMode() });
  } catch (error) {
    return failure(error);
  }
}
