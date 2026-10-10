/**
 * The promo-code arithmetic, shared by the package screen (to show the price as the guest picks)
 * and the server (which decides it). No server imports, so a guest screen can use it.
 */
export type VoucherKind = 'percent' | 'amount' | 'free';

/** QRIS refuses smaller amounts, so a discount never leaves a price under this unless it is free. */
export const QRIS_MIN_IDR = 1500;

/** What the guest sees next to the code: "Diskon 20%", "Potongan Rp10.000", "Gratis". */
export function voucherLabel(v: { kind: VoucherKind; value: number }): string {
  if (v.kind === 'free') return 'Gratis';
  if (v.kind === 'percent') return `Diskon ${v.value}%`;
  return `Potongan Rp${v.value.toLocaleString('id-ID')}`;
}

/** The price after the code. A cut that would leave less than QRIS takes stops at its minimum. */
export function discounted(total: number, v: { kind: VoucherKind; value: number }): { total: number; discount: number } {
  let after = v.kind === 'free' ? 0 : v.kind === 'percent' ? Math.round((total * (100 - v.value)) / 100) : total - v.value;
  after = Math.max(after, 0);
  if (after > 0 && after < QRIS_MIN_IDR) after = Math.min(QRIS_MIN_IDR, total);
  return { total: after, discount: total - after };
}
