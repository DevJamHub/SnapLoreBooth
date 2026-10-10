import { db } from './db';
import type { VoucherKind } from './promo';

export { QRIS_MIN_IDR, discounted, voucherLabel, type VoucherKind } from './promo';

/**
 * Promo codes the operator hands out (an influencer's code, a wedding's "free for guests" code,
 * a weekend discount). The guest types one on the package screen; the server works out the
 * price with it, as it does every price, and the session keeps the code and the discount.
 */
export interface Voucher {
  code: string;
  kind: VoucherKind;
  /** Percent off (1–99) or Rupiah off; 0 for free. */
  value: number;
  /** How many sessions may use it; null for no limit. */
  max_uses: number | null;
  /** Sessions that used it (still on the booth). */
  used: number;
  /** Last moment it works; null for no end. */
  expires_at: string | null;
  active: boolean;
  note: string;
  created_at: string;
}

export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;
const MAX_NOTE = 60;

export class VoucherError extends Error {}

interface VoucherRow extends Omit<Voucher, 'active' | 'used'> {
  active: number;
  used: number;
}

const SELECT = `SELECT v.*, (SELECT COUNT(*) FROM sessions s WHERE s.voucher = v.code) AS used FROM vouchers v`;

function hydrate(row: VoucherRow): Voucher {
  return { ...row, active: row.active === 1 };
}

export function normalizeCode(code: unknown): string {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function listVouchers(): Voucher[] {
  return (db.prepare(`${SELECT} ORDER BY v.created_at DESC`).all() as VoucherRow[]).map(hydrate);
}

export function voucherByCode(code: string): Voucher | null {
  const row = db.prepare(`${SELECT} WHERE v.code = ?`).get(normalizeCode(code)) as VoucherRow | undefined;
  return row ? hydrate(row) : null;
}

/** The code if a guest may use it now; otherwise why not, in the guest's words. */
export function usableVoucher(code: string): Voucher {
  const voucher = voucherByCode(code);
  if (!voucher || !voucher.active) throw new VoucherError('Kode promo tidak dikenal.');
  if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) throw new VoucherError('Kode promo sudah berakhir.');
  if (voucher.max_uses !== null && voucher.used >= voucher.max_uses) throw new VoucherError('Kuota kode promo sudah habis.');
  return voucher;
}

/** Operator input → a stored code. Refuses what the console would not offer. */
export function createVoucher(input: Record<string, unknown>): Voucher {
  const code = normalizeCode(input.code);
  if (!CODE_PATTERN.test(code)) throw new VoucherError('kode 3–20 huruf/angka, tanpa spasi');
  if (voucherByCode(code)) throw new VoucherError(`kode ${code} sudah ada`);
  const kind = input.kind as VoucherKind;
  if (!['percent', 'amount', 'free'].includes(kind)) throw new VoucherError('jenis promo tidak dikenal');
  const value = kind === 'free' ? 0 : Number(input.value);
  if (kind === 'percent' && (!Number.isInteger(value) || value < 1 || value > 99)) throw new VoucherError('diskon 1–99%');
  if (kind === 'amount' && (!Number.isInteger(value) || value < 500 || value > 10_000_000)) throw new VoucherError('potongan minimal Rp500');
  const maxUses = input.max_uses === null || input.max_uses === undefined || input.max_uses === '' ? null : Number(input.max_uses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100_000)) throw new VoucherError('kuota harus bilangan 1 ke atas, atau kosong');
  let expiresAt: string | null = null;
  if (typeof input.expires_at === 'string' && input.expires_at) {
    const at = new Date(input.expires_at);
    if (Number.isNaN(at.getTime())) throw new VoucherError('tanggal berakhir tidak valid');
    expiresAt = at.toISOString();
  }
  const note = typeof input.note === 'string' ? input.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '';

  db.prepare(
    `INSERT INTO vouchers (code, kind, value, max_uses, expires_at, active, note, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(code, kind, value, maxUses, expiresAt, note, new Date().toISOString());
  return voucherByCode(code)!;
}

export function setVoucherActive(code: string, active: boolean): Voucher | null {
  db.prepare('UPDATE vouchers SET active = ? WHERE code = ?').run(active ? 1 : 0, normalizeCode(code));
  return voucherByCode(code);
}

/** Removes the code; sessions that used it keep it on their record. */
export function deleteVoucher(code: string): boolean {
  return db.prepare('DELETE FROM vouchers WHERE code = ?').run(normalizeCode(code)).changes > 0;
}
