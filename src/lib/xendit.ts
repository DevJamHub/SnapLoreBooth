/**
 * Minimal client for Xendit's QR Codes API (QRIS), version 2022-07-31.
 * The secret key never leaves the server: the kiosk only ever sees the qr_string.
 */
const API_BASE = 'https://api.xendit.co';
const API_VERSION = '2022-07-31';

export class XenditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface XenditQr {
  id: string;
  reference_id: string;
  amount: number;
  status: 'ACTIVE' | 'INACTIVE';
  qr_string: string;
  expires_at: string;
}

export interface XenditQrPayment {
  id: string;
  qr_id: string;
  reference_id: string;
  amount: number;
  status: 'SUCCEEDED' | string;
  created: string;
}

function secretKey(): string {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) throw new XenditError('XENDIT_SECRET_KEY is not set', 503);
  return key;
}

/** Development keys can simulate a payment; production keys never can. */
export function isTestMode(): boolean {
  return process.env.XENDIT_SECRET_KEY?.startsWith('xnd_development_') === true;
}

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString('base64')}`,
      'api-version': API_VERSION,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error_code?: string };
  if (!res.ok) throw new XenditError(data.message ?? data.error_code ?? `Xendit answered ${res.status}`, res.status);
  return data;
}

export function createDynamicQr(input: { referenceId: string; amount: number; expiresAt: Date }): Promise<XenditQr> {
  return call<XenditQr>('/qr_codes', {
    method: 'POST',
    body: {
      reference_id: input.referenceId,
      type: 'DYNAMIC',
      currency: 'IDR',
      amount: input.amount,
      expires_at: input.expiresAt.toISOString(),
    },
  });
}

export async function listQrPayments(qrId: string): Promise<XenditQrPayment[]> {
  const data = await call<{ data: XenditQrPayment[] }>(`/qr_codes/${encodeURIComponent(qrId)}/payments`, { method: 'GET' });
  return data.data ?? [];
}

export function simulateQrPayment(qrId: string, amount: number): Promise<XenditQrPayment> {
  if (!isTestMode()) throw new XenditError('payment simulation needs a development key', 403);
  return call<XenditQrPayment>(`/qr_codes/${encodeURIComponent(qrId)}/payments/simulate`, {
    method: 'POST',
    body: { amount },
  });
}
