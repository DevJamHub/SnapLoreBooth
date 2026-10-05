'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ADDONS, PACKAGES } from '@/lib/packages';
import type { BoothEvent, PaymentMode, PrintMode } from '@/lib/types';

export default function EventPanel({
  event,
  prices: initialPrices,
  xenditReady,
}: {
  event: BoothEvent;
  prices: Record<string, number>;
  xenditReady: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(event.name);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(event.payment_mode);
  const [printMode, setPrintMode] = useState<PrintMode>(event.print_mode);
  const [gallery, setGallery] = useState(event.gallery);
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initialPrices).map(([k, v]) => [k, String(v)])),
  );
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [starting, setStarting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  /** Ending opens the full photo gallery on every screen showing the event link. */
  const setEnded = async (ended: boolean) => {
    setEnding(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/event', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal mengubah status acara');
      setConfirmEnd(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mengubah status acara');
    } finally {
      setEnding(false);
    }
  };

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/operator/event', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          payment_mode: paymentMode,
          print_mode: printMode,
          gallery,
          prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Number(v)])),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan');
      setState('saved');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan');
      setState('idle');
    }
  };

  const startNew = async () => {
    if (!newName.trim()) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal membuat acara');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal membuat acara');
      setStarting(false);
    }
  };

  const dirty = () => setState('idle');

  return (
    <>
      <section className="op-card">
        <div className="op-card-head">
          <h2>Pengaturan acara</h2>
          {state === 'saved' && <span className="op-chip" data-tone="ok">Tersimpan</span>}
        </div>

        <label className="op-field">
          <span className="op-label">Nama acara · tercetak di foto</span>
          <input className="field" value={name} maxLength={40} onChange={(e) => (setName(e.target.value), dirty())} />
        </label>

        <div className="op-field">
          <span className="op-label">Pembayaran tamu</span>
          <div className="segmented">
            <button aria-pressed={paymentMode === 'qris'} onClick={() => (setPaymentMode('qris'), dirty())}>
              QRIS
            </button>
            <button aria-pressed={paymentMode === 'free'} onClick={() => (setPaymentMode('free'), dirty())}>
              Gratis (sewa)
            </button>
          </div>
          {paymentMode === 'qris' && !xenditReady && (
            <div className="notice notice-error">XENDIT_SECRET_KEY belum diisi: tamu tidak akan bisa membayar.</div>
          )}
        </div>

        {paymentMode === 'qris' && (
          <div className="op-field">
            <span className="op-label">Harga (Rp · 0 = gratis)</span>
            <div className="op-prices">
              {[...PACKAGES, ...ADDONS].map((item) => (
                <label key={item.id}>
                  <span>{item.label}</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    value={prices[item.id] ?? ''}
                    onChange={(e) => (setPrices({ ...prices, [item.id]: e.target.value.replace(/\D/g, '') }), dirty())}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="op-field">
          <span className="op-label">Cetak</span>
          <div className="segmented">
            <button aria-pressed={printMode === 'simulated'} onClick={() => (setPrintMode('simulated'), dirty())}>
              Simulasi
            </button>
            <button aria-pressed={printMode === 'airprint'} onClick={() => (setPrintMode('airprint'), dirty())}>
              AirPrint
            </button>
          </div>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={gallery} onChange={(e) => (setGallery(e.target.checked), dirty())} />
          <span style={{ fontSize: 14 }}>Galeri & layar kedua aktif</span>
        </label>

        {error && <div className="notice notice-error">{error}</div>}
        <button className="pill" onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Menyimpan…' : 'Simpan pengaturan'}
        </button>
      </section>

      <section className="op-card">
        <div className="op-card-head">
          <h2>Status acara</h2>
        </div>
        <p className="op-muted">
          {event.ended_at
            ? 'Selesai. Link acara sekarang menampilkan galeri foto untuk didownload tamu.'
            : 'Berjalan. Link acara menampilkan video live tamu bergantian; galeri dibuka saat acara diakhiri.'}
        </p>
        {event.ended_at ? (
          <button className="pill pill-ghost" onClick={() => setEnded(false)} disabled={ending}>
            {ending ? 'Membuka…' : 'Buka lagi acara'}
          </button>
        ) : confirmEnd ? (
          <div className="op-row">
            <button className="pill" onClick={() => setEnded(true)} disabled={ending} style={{ flex: 1 }}>
              {ending ? 'Mengakhiri…' : 'Ya, akhiri & buka galeri'}
            </button>
            <button className="pill pill-ghost" onClick={() => setConfirmEnd(false)} disabled={ending}>
              Batal
            </button>
          </div>
        ) : (
          <button className="pill pill-ghost" onClick={() => setConfirmEnd(true)}>
            Akhiri acara
          </button>
        )}

        <div className="op-divider" />
        <label className="op-field">
          <span className="op-label">Mulai acara baru</span>
          <div className="op-row op-row-fill">
            <input className="field" placeholder="mis. Nikahan Rina & Dimas" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
            <button className="pill pill-ghost" onClick={startNew} disabled={starting || !newName.trim()} style={{ flex: 'none' }}>
              {starting ? 'Membuat…' : 'Mulai'}
            </button>
          </div>
        </label>
        <p className="op-muted" style={{ fontSize: 12 }}>
          Acara ini otomatis diakhiri. Harga dan pengaturan disalin; link acara baru dibuat.
        </p>
      </section>
    </>
  );
}
