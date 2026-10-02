'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { useIdle } from '@/components/guest/hooks';
import { ArrowLeft, ArrowRight, Check } from '@/components/guest/icons';
import { EXTRA_PRINT, MAX_EXTRA_PRINTS, PACKAGES, formatPrice } from '@/lib/packages';
import type { Session } from '@/lib/types';

const IDLE_MS = 60_000;

export default function PackagePicker({ payments, prices }: { payments: boolean; prices: Record<string, number> }) {
  const router = useRouter();
  const [packageId, setPackageId] = useState(PACKAGES[0].id);
  const [extra, setExtra] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useIdle(starting ? null : IDLE_MS, () => router.replace('/'));

  const price = (id: string) => prices[id] ?? 0;
  const total = price(packageId) + extra * price(EXTRA_PRINT.id);
  const priced = (id: string) => (price(id) > 0 ? formatPrice(price(id)) : 'Gratis');

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, extraPrints: extra }),
      });
      const data = (await res.json()) as { session?: Session; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error);
      router.push(`/hias/${data.session.id}`);
    } catch {
      setError('Booth belum siap. Coba sentuh lagi sebentar, atau panggil petugas.');
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
            <ArrowLeft /> Kembali
          </button>
        }
      />

      <h1 className="g-title">Mau berapa pose?</h1>

      <div className="pkg-grid">
        {PACKAGES.map((pkg) => (
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
            <span className="pkg-name">{pkg.label}</span>
            <span className="pkg-blurb">{pkg.blurb}</span>
            <span className="pkg-foot">
              <span className="pkg-meta">1 lembar 4R</span>
              <span className="pkg-price">{payments ? priced(pkg.id) : ''}</span>
            </span>
          </button>
        ))}
      </div>

      {error && <div className="g-error">{error}</div>}

      <div className="g-bar">
        <div>
          <div className="g-bar-label">
            Total · {1 + extra} lembar cetak
          </div>
          <div className="g-bar-value">{payments ? (total > 0 ? formatPrice(total) : 'Gratis') : 'Gratis'}</div>
        </div>
        <div className="stepper" aria-label="Cetak tambahan">
          <button className="stepper-btn" onClick={() => setExtra((n) => Math.max(n - 1, 0))} disabled={extra === 0} aria-label="Kurangi cetakan">
            −
          </button>
          <div className="stepper-label">
            <b>{EXTRA_PRINT.label}</b>
            <small>
              {extra > 0 ? `${extra} tambahan` : 'tambah cetakan'}
              {payments && price(EXTRA_PRINT.id) > 0 ? ` · ${formatPrice(price(EXTRA_PRINT.id))}/lembar` : ''}
            </small>
          </div>
          <button className="stepper-btn" onClick={() => setExtra((n) => Math.min(n + 1, MAX_EXTRA_PRINTS))} disabled={extra >= MAX_EXTRA_PRINTS} aria-label="Tambah cetakan">
            +
          </button>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={start} disabled={starting}>
          {starting ? 'Menyiapkan…' : 'Pilih frame'} <ArrowRight />
        </button>
      </div>
    </main>
  );
}
