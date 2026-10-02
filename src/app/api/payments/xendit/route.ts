import { NextResponse } from 'next/server';
import { getPayment, markPaymentPaid } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface QrPaymentEvent {
  event?: string;
  data?: { id?: string; qr_id?: string; amount?: number; status?: string };
}

/** Compares in constant time so the response latency does not leak the token. */
function matches(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Xendit's QR payment callback. Register this URL in the dashboard under
 * Settings → Webhooks → QR code paid. Only reachable when the booth has a public URL;
 * otherwise the kiosk's poll settles the payment instead.
 */
export async function POST(request: Request) {
  const expected = process.env.XENDIT_CALLBACK_TOKEN;
  if (!expected) return NextResponse.json({ error: 'XENDIT_CALLBACK_TOKEN is not set' }, { status: 503 });
  if (!matches(request.headers.get('x-callback-token') ?? '', expected)) {
    return NextResponse.json({ error: 'invalid callback token' }, { status: 401 });
  }

  let body: QrPaymentEvent;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const data = body.data;
  if (body.event !== 'qr.payment' || data?.status !== 'SUCCEEDED' || !data.qr_id || !data.id) {
    // Acknowledge anything we do not act on, or Xendit keeps retrying it.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const payment = getPayment(data.qr_id);
  if (!payment) return NextResponse.json({ ok: true, ignored: true });
  if ((data.amount ?? 0) < payment.amount_idr) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'amount below the session price' });
  }

  markPaymentPaid(payment.id, data.id);
  return NextResponse.json({ ok: true });
}
