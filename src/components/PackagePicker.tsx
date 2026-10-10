'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { useIdle } from '@/components/guest/hooks';
import { ArrowLeft, ArrowRight, Check } from '@/components/guest/icons';
import { LangToggle, useT } from '@/components/guest/lang';
import { EXTRA_PRINT, PACKAGES, formatPrice } from '@/lib/packages';
import { discounted, type VoucherKind } from '@/lib/promo';
import type { Session } from '@/lib/types';

export default function PackagePicker({
  payments,
  prices,
  enabled,
  maxExtra,
  idleSeconds,
  promo,
  english,
}: {
  payments: boolean;
  prices: Record<string, number>;
  /** Package ids the operator offers. */
  enabled: string[];
  /** 0 hides extra prints. */
  maxExtra: number;
  idleSeconds: number;
  /** Offer a promo-code field. */
  promo: boolean;
  /** Offer the ID · EN switch. */
  english: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const packages = PACKAGES.filter((p) => enabled.includes(p.id));
  const [packageId, setPackageId] = useState(packages[0]?.id ?? PACKAGES[0].id);
  const [extra, setExtra] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<{ code: string; kind: VoucherKind; value: number } | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  useIdle(starting ? null : idleSeconds * 1000, () => router.replace('/'));

  const price = (id: string) => prices[id] ?? 0;
  const listTotal = price(packageId) + extra * price(EXTRA_PRINT.id);
  // Shown as the guest picks; the server works the price out again when the session starts.
  const total = voucher && listTotal > 0 ? discounted(listTotal, voucher).total : listTotal;

  const checkCode = async () => {
    setChecking(true);
    setPromoError(null);
    try {
      const res = await fetch('/api/vouchers/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, packageId, extraPrints: extra }),
      });
      const data = (await res.json()) as { code?: string; kind?: VoucherKind; value?: number; error?: string };
      if (!res.ok || !data.code || !data.kind) throw new Error(data.error ?? 'Kode promo belum bisa dipakai.');
      setVoucher({ code: data.code, kind: data.kind, value: data.value ?? 0 });
      setPromoOpen(false);
      setCode('');
    } catch (err) {
      setPromoError(t(err instanceof Error && err.message ? err.message : 'Kode promo belum bisa dipakai.'));
    } finally {
      setChecking(false);
    }
  };
  const priced = (id: string) => (price(id) > 0 ? formatPrice(price(id)) : t('Gratis'));
  const promoLabel = (v: { kind: VoucherKind; value: number }) =>
    v.kind === 'free' ? t('Gratis') : v.kind === 'percent' ? t('Diskon {n}%', { n: v.value }) : t('Potongan {amount}', { amount: formatPrice(v.value) });

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, extraPrints: extra, voucher: voucher?.code }),
      });
      const data = (await res.json()) as { session?: Session; error?: string };
      // A code that ran out between Pakai and now is dropped, and the guest sees why.
      if (res.status === 400 && voucher && data.error && /promo/i.test(data.error)) {
        setVoucher(null);
        setError(`${t(data.error)} ${t('Harga kembali normal.')}`);
        setStarting(false);
        return;
      }
      if (!res.ok || !data.session) throw new Error(data.error);
      router.push(`/hias/${data.session.id}`);
    } catch {
      setError(t('Booth belum siap. Coba sentuh lagi sebentar, atau panggil petugas.'));
      setStarting(false);
    }
  };

  return (
    <main className="g-screen">
      <GuestHeader
        step="pilih"
        payments={payments}
        left={
          <button className="g-ghost" onClick={() => router.replace('/')} disabled={starting}>
            <ArrowLeft /> {t('Kembali')}
          </button>
        }
        right={english ? <LangToggle /> : undefined}
      />

      <h1 className="g-title">{t('Mau berapa pose?')}</h1>

      <div className="pkg-grid" data-count={packages.length}>
        {packages.map((pkg) => (
          <button key={pkg.id} className="pkg-card" aria-pressed={pkg.id === packageId} onClick={() => setPackageId(pkg.id)}>
            <span className="pkg-tick">
              <Check />
            </span>
            <span className="pkg-art">
              <span className="art-board" style={{ gridTemplateColumns: `repeat(${pkg.cols}, 1fr)`, gridTemplateRows: `repeat(${pkg.rows}, 1fr)` }}>
                {Array.from({ length: pkg.shots }, (_, i) => (
                  <span key={i} className="art-cell" />
                ))}
              </span>
            </span>
            <span className="pkg-name">{t(pkg.label)}</span>
            <span className="pkg-blurb">{t(pkg.blurb)}</span>
            <span className="pkg-foot">
              <span className="pkg-meta">{t('1 lembar 4R')}</span>
              <span className="pkg-price">{payments ? priced(pkg.id) : ''}</span>
            </span>
          </button>
        ))}
      </div>

      {error && <div className="g-error">{error}</div>}

      <div className="g-bar">
        <div>
          <div className="g-bar-label">
            {t('Total · {n} lembar cetak', { n: 1 + extra })}
          </div>
          <div className="g-bar-value">
            {payments && voucher && listTotal > total && <s className="pkg-was">{formatPrice(listTotal)}</s>}
            {payments && total > 0 ? formatPrice(total) : t('Gratis')}
          </div>
        </div>
        {payments && promo && (
          <button className="g-ghost pkg-promo" onClick={() => (voucher ? setVoucher(null) : setPromoOpen(true))} disabled={starting}>
            {voucher ? (
              <>
                <b>{voucher.code}</b> {promoLabel(voucher)} <span aria-label={t('Hapus kode')}>×</span>
              </>
            ) : (
              t('Kode promo')
            )}
          </button>
        )}
        <div className="stepper" aria-label={t('Cetak tambahan')} hidden={maxExtra === 0}>
          <button className="stepper-btn" onClick={() => setExtra((n) => Math.max(n - 1, 0))} disabled={extra === 0} aria-label={t('Kurangi cetakan')}>
            −
          </button>
          <div className="stepper-label">
            <b>{t(EXTRA_PRINT.label)}</b>
            <small>
              {extra > 0 ? t('{n} tambahan', { n: extra }) : t('tambah cetakan')}
              {payments && price(EXTRA_PRINT.id) > 0 ? ` · ${t('{price}/lembar', { price: formatPrice(price(EXTRA_PRINT.id)) })}` : ''}
            </small>
          </div>
          <button className="stepper-btn" onClick={() => setExtra((n) => Math.min(n + 1, maxExtra))} disabled={extra >= maxExtra} aria-label={t('Tambah cetakan')}>
            +
          </button>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={start} disabled={starting}>
          {starting ? t('Menyiapkan…') : t('Pilih frame')} <ArrowRight />
        </button>
      </div>

      {promoOpen && (
        <div className="g-modal-backdrop" onClick={() => !checking && setPromoOpen(false)}>
          <div className="g-modal" role="dialog" aria-modal="true" aria-label={t('Kode promo')} onClick={(e) => e.stopPropagation()}>
            <h2>{t('Punya kode promo?')}</h2>
            <input
              className="dc-input pkg-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
              onKeyDown={(e) => e.key === 'Enter' && code.length >= 3 && void checkCode()}
              placeholder="KODEPROMO"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              autoFocus
            />
            {promoError && <div className="g-error">{promoError}</div>}
            <div className="g-modal-actions">
              <button className="g-cta" onClick={checkCode} disabled={checking || code.length < 3} style={{ minHeight: 64, fontSize: 19 }}>
                {checking ? t('Mengecek…') : t('Pakai')}
              </button>
              <button className="g-ghost" onClick={() => setPromoOpen(false)} disabled={checking}>
                {t('Batal')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
