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

/**
 * XENDIT_SECRET_KEY=mock stands in for Xendit without a network: QR codes are made up and paid
 * only through *Simulasi bayar*. For rehearsals without internet and for the end-to-end tests.
 */
function mocked(): boolean {
  return process.env.XENDIT_SECRET_KEY === 'mock';
}

interface MockStore {
  qrs: Map<string, XenditQr>;
  payments: Map<string, XenditQrPayment[]>;
}
const globalForMock = globalThis as unknown as { __xenditMock?: MockStore };
function mockStore(): MockStore {
  globalForMock.__xenditMock ??= { qrs: new Map(), payments: new Map() };
  return globalForMock.__xenditMock;
}

/** Development keys (and the mock) can simulate a payment; production keys never can. */
export function isTestMode(): boolean {
  return mocked() || process.env.XENDIT_SECRET_KEY?.startsWith('xnd_development_') === true;
}

/**
 * A hung request would never settle: the QR being issued for that session (shared by every
 * screen asking, see ensurePayment) would wait forever and the guest could never pay.
 */
const TIMEOUT_MS = 15_000;

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString('base64')}`,
        'api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new XenditError(timedOut ? 'Xendit tidak menjawab; coba lagi' : 'Tidak bisa menghubungi Xendit; cek internet booth', 503);
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error_code?: string };
  if (!res.ok) throw new XenditError(data.message ?? data.error_code ?? `Xendit answered ${res.status}`, res.status);
  return data;
}

export function createDynamicQr(input: { referenceId: string; amount: number; expiresAt: Date }): Promise<XenditQr> {
  if (mocked()) {
    const id = `qr_mock_${crypto.randomUUID()}`;
    const qr: XenditQr = {
      id,
      reference_id: input.referenceId,
      amount: input.amount,
      status: 'ACTIVE',
      qr_string: `MOCK-QRIS|${input.referenceId}|${input.amount}`,
      expires_at: input.expiresAt.toISOString(),
    };
    mockStore().qrs.set(id, qr);
    return Promise.resolve(qr);
  }
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
  if (mocked()) return mockStore().payments.get(qrId) ?? [];
  const data = await call<{ data: XenditQrPayment[] }>(`/qr_codes/${encodeURIComponent(qrId)}/payments`, { method: 'GET' });
  return data.data ?? [];
}

export function simulateQrPayment(qrId: string, amount: number): Promise<XenditQrPayment> {
  if (!isTestMode()) throw new XenditError('payment simulation needs a development key', 403);
  if (mocked()) {
    const qr = mockStore().qrs.get(qrId);
    if (!qr) return Promise.reject(new XenditError('QR not found', 404));
    const payment: XenditQrPayment = {
      id: `qrpy_mock_${crypto.randomUUID()}`,
      qr_id: qrId,
      reference_id: qr.reference_id,
      amount,
      status: 'SUCCEEDED',
      created: new Date().toISOString(),
    };
    mockStore().payments.set(qrId, [...(mockStore().payments.get(qrId) ?? []), payment]);
    return Promise.resolve(payment);
  }
  return call<XenditQrPayment>(`/qr_codes/${encodeURIComponent(qrId)}/payments/simulate`, {
    method: 'POST',
    body: { amount },
  });
}
