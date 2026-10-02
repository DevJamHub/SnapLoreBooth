'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { useIdle } from '@/components/guest/hooks';
import { ArrowLeft, ArrowRight, Check } from '@/components/guest/icons';
import { ADDONS, PACKAGES, formatPrice } from '@/lib/packages';
import type { Session } from '@/lib/types';

const IDLE_MS = 60_000;

export default function PackagePicker({ payments }: { payments: boolean }) {
  const router = useRouter();
  const [packageId, setPackageId] = useState(PACKAGES[0].id);
  const [addons, setAddons] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useIdle(starting ? null : IDLE_MS, () => router.replace('/'));

  const selected = PACKAGES.find((p) => p.id === packageId)!;
  const chosen = ADDONS.filter((a) => addons.includes(a.id));
  const total = selected.priceIdr + chosen.reduce((sum, a) => sum + a.priceIdr, 0);
  const prints = selected.prints + chosen.reduce((sum, a) => sum + a.extraPrints, 0);

  const toggle = (id: string) =>
    setAddons((current) => (current.includes(id) ? current.filter((a) => a !== id) : [...current, id]));

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, addons }),
      });
      const data = (await res.json()) as { session?: Session; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error);
      router.push(payments ? `/pay/${data.session.id}` : `/capture/${data.session.id}`);
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

      <div className="pkg-head">
        <div>
          <h1 className="g-title">Mau foto yang mana?</h1>
        </div>
      </div>

      <div className="pkg-grid">
        {PACKAGES.map((pkg) => (
          <button
            key={pkg.id}
            className="pkg-card"
            aria-pressed={pkg.id === packageId}
            onClick={() => setPackageId(pkg.id)}
          >
            <span className="pkg-tick">
              <Check />
            </span>
            <span className="pkg-art">
              <span className="art-board" data-format={pkg.format}>
                {Array.from({ length: pkg.shots }, (_, i) => (
                  <span key={i} className="art-cell" />
                ))}
              </span>
            </span>
            <span className="pkg-name">{pkg.label}</span>
            <span className="pkg-blurb">{pkg.blurb}</span>
            <span className="pkg-foot">
              <span className="pkg-meta">
                {pkg.shots} pose · {pkg.prints} cetak
              </span>
              <span className="pkg-price">{formatPrice(pkg.priceIdr)}</span>
            </span>
          </button>
        ))}
      </div>

      {error && <div className="g-error">{error}</div>}

      <div className="g-bar">
        <div>
          <div className="g-bar-label">
            Total · {prints} lembar cetak
          </div>
          <div className="g-bar-value">{formatPrice(total)}</div>
        </div>
        {ADDONS.map((addon) => (
          <button
            key={addon.id}
            className="addon"
            aria-pressed={addons.includes(addon.id)}
            onClick={() => toggle(addon.id)}
          >
            <span className="switch" />
            {addon.label} <small>+{formatPrice(addon.priceIdr)}</small>
          </button>
        ))}
        <span className="g-spacer" />
        <button className="g-cta" onClick={start} disabled={starting}>
          {starting ? 'Menyiapkan…' : payments ? 'Lanjut bayar' : 'Mulai foto'} <ArrowRight />
        </button>
      </div>
    </main>
  );
}
