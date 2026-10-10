import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { currentEvent, priceOf } from '@/lib/events';
import { EXTRA_PRINT, packageById } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';
import { VoucherError, discounted, normalizeCode, usableVoucher, voucherLabel } from '@/lib/vouchers';

export const dynamic = 'force-dynamic';

/** Tries per address in the window; enough for typos, too few to guess codes by brute force. */
const MAX_TRIES = 20;
const WINDOW_MS = 10 * 60_000;
const tries = new Map<string, { count: number; since: number }>();

function allowed(request: Request): boolean {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  const now = Date.now();
  const entry = tries.get(ip);
  if (!entry || now - entry.since > WINDOW_MS) {
    tries.set(ip, { count: 1, since: now });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_TRIES;
}

/**
 * The package screen's "Pakai" on a promo code: what it takes off this choice. Nothing is held;
 * the code is checked again when the session starts.
 */
export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: 'Terlalu banyak percobaan. Tunggu sebentar, ya.' }, { status: 429 });
  let body: { code?: unknown; packageId?: unknown; extraPrints?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (!paymentsEnabled()) return NextResponse.json({ error: 'Booth sedang gratis, tidak perlu kode promo.' }, { status: 400 });

  const pkg = packageById(String(body.packageId ?? ''));
  if (!pkg || !getConfig().packages.enabled.includes(pkg.id)) return NextResponse.json({ error: 'unknown packageId' }, { status: 400 });
  const extra = Math.max(0, Math.min(Number(body.extraPrints) || 0, 50));
  const event = currentEvent();
  const total = priceOf(event, pkg.id) + extra * priceOf(event, EXTRA_PRINT.id);

  try {
    const voucher = usableVoucher(normalizeCode(body.code));
    const after = discounted(total, voucher);
    return NextResponse.json({ code: voucher.code, label: voucherLabel(voucher), kind: voucher.kind, value: voucher.value, ...after });
  } catch (error) {
    if (error instanceof VoucherError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
