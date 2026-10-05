import { getConfig } from './config';
import { createPayment, getSession, isSessionPaid, latestPayment, markPaymentPaid } from './db';
import { currentEvent } from './events';
import type { Payment, Session } from './types';
import { createDynamicQr, listQrPayments } from './xendit';

/** Do not ask Xendit more often than this per QR; the webhook is the fast path. */
const POLL_THROTTLE_MS = 3000;

const lastPolled = new Map<string, number>();

/**
 * Whether new guests pay by QRIS. Set per event in the operator console; `PAYMENT=off` in the
 * environment overrides every event, for rehearsals.
 */
export function paymentsEnabled(): boolean {
  return process.env.PAYMENT !== 'off' && currentEvent().payment_mode === 'qris';
}

export function sessionUnlocked(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  return !session.requires_payment || process.env.PAYMENT === 'off' || isSessionPaid(sessionId);
}

function expired(payment: Payment): boolean {
  return payment.status !== 'paid' && new Date(payment.expires_at).getTime() <= Date.now();
}

const issuing = new Map<string, Promise<Payment>>();

/** Returns the session's live QR, issuing a new one when none exists or the last expired. */
export function ensurePayment(session: Session): Promise<Payment> {
  const current = latestPayment(session.id);
  if (current && !expired(current)) return Promise.resolve(current);

  // Two screens (or a double-mounted effect) asking at once must not mint two QRs.
  const pending = issuing.get(session.id);
  if (pending) return pending;

  const job = issueQr(session).finally(() => issuing.delete(session.id));
  issuing.set(session.id, job);
  return job;
}

async function issueQr(session: Session): Promise<Payment> {
  // How long a guest has to scan before the QR is retired and a fresh one issued.
  const expiresAt = new Date(Date.now() + getConfig().flow.paymentMinutes * 60_000);
  const qr = await createDynamicQr({
    // reference_id must be unique per QR, so a reissue after expiry gets its own suffix.
    referenceId: `${session.id}-${Date.now().toString(36)}`,
    amount: session.price_idr,
    expiresAt,
  });

  return createPayment({
    id: qr.id,
    sessionId: session.id,
    amountIdr: qr.amount,
    qrString: qr.qr_string,
    expiresAt: qr.expires_at ?? expiresAt.toISOString(),
  });
}

/**
 * Asks Xendit whether a pending QR has been paid. Covers a booth with no public URL, where
 * the webhook cannot reach it.
 */
export async function refreshPayment(payment: Payment): Promise<Payment> {
  if (payment.status === 'paid') return payment;

  const now = Date.now();
  if (now - (lastPolled.get(payment.id) ?? 0) < POLL_THROTTLE_MS) return payment;
  lastPolled.set(payment.id, now);

  const settled = (await listQrPayments(payment.id)).find(
    (p) => p.status === 'SUCCEEDED' && p.amount >= payment.amount_idr,
  );
  if (!settled) return payment;

  lastPolled.delete(payment.id);
  return markPaymentPaid(payment.id, settled.id) ?? payment;
}

/** What the kiosk is allowed to see: never the provider's ids beyond the QR itself. */
export function publicPayment(payment: Payment) {
  return {
    status: payment.status === 'paid' ? 'paid' : expired(payment) ? 'expired' : 'pending',
    amount_idr: payment.amount_idr,
    qr_string: payment.qr_string,
    expires_at: payment.expires_at,
  } as const;
}
