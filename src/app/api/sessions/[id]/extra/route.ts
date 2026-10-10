import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { getSession, latestPayment } from '@/lib/db';
import { ensureExtraPayment, extraSheetPrice, paymentsEnabled, publicPayment, refreshPayment } from '@/lib/payments';
import { XenditError, isTestMode } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  // 503 rather than 502: a Cloudflare tunnel would swap a 502 for its own HTML page.
  if (error instanceof XenditError) return NextResponse.json({ error: error.message }, { status: error.status >= 500 ? 503 : error.status });
  throw error;
}

/**
 * "Cetak lagi" on the print screen: a QR for more sheets of a finished sheet. Paid, the sheets
 * are added to the session (see markPaymentPaid) and the screen prints them.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session?.strip_file) return NextResponse.json({ error: 'session not found' }, { status: 404 });
  const config = getConfig();
  if (!paymentsEnabled() || !config.share.upsell) return NextResponse.json({ error: 'extra sheets are not offered' }, { status: 409 });
  if (extraSheetPrice(session) <= 0) return NextResponse.json({ error: 'extra sheets have no price' }, { status: 409 });

  let body: { copies?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const copies = Number(body.copies);
  if (!Number.isInteger(copies) || copies < 1 || copies > config.packages.maxExtra) {
    return NextResponse.json({ error: `copies must be 1–${config.packages.maxExtra}` }, { status: 400 });
  }

  try {
    const payment = await ensureExtraPayment(session, copies);
    return NextResponse.json({ payment: publicPayment(payment), copies, testMode: isTestMode() });
  } catch (error) {
    return failure(error);
  }
}

/** What the print screen polls while the guest pays for more sheets. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = latestPayment(id, 'extra');
  if (!current) return NextResponse.json({ error: 'no extra sheets asked for' }, { status: 404 });
  try {
    const payment = await refreshPayment(current);
    return NextResponse.json({ payment: publicPayment(payment), copies: payment.copies, testMode: isTestMode() });
  } catch (error) {
    return failure(error);
  }
}
