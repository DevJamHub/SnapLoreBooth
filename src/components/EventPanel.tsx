'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ADDONS, PACKAGES } from '@/lib/packages';
import type { BoothEvent, PaymentMode, PrintMode } from '@/lib/types';

export default function EventPanel({
  event,
  prices: initialPrices,
  galleryUrl,
  galleryQr,
  xenditReady,
}: {
  event: BoothEvent;
  prices: Record<string, number>;
  galleryUrl: string;
  galleryQr: string;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <span className="status-item">
          <i className={`dot ${event.ended_at ? 'dot-warn' : 'dot-ok'}`} />
          <span className="mono">{event.ended_at ? 'ACARA SELESAI · GALERI DIBUKA' : 'ACARA BERJALAN'}</span>
        </span>
        <label className="field-label">
          <span className="mono mono-sm">NAMA ACARA (TERCETAK DI FOTO)</span>
          <input className="field" value={name} maxLength={40} onChange={(e) => (setName(e.target.value), dirty())} />
        </label>

        <div className="field-label">
          <span className="mono mono-sm">PEMBAYARAN TAMU</span>
          <div className="segmented">
            <button aria-pressed={paymentMode === 'qris'} onClick={() => (setPaymentMode('qris'), dirty())}>
              QRIS (tamu bayar)
            </button>
            <button aria-pressed={paymentMode === 'free'} onClick={() => (setPaymentMode('free'), dirty())}>
              Gratis (sewa acara)
            </button>
          </div>
          {paymentMode === 'qris' && !xenditReady && (
            <div className="notice notice-error">XENDIT_SECRET_KEY belum diisi — tamu tidak akan bisa membayar.</div>
          )}
        </div>

        <div className="field-label">
          <span className="mono mono-sm">CETAK</span>
          <div className="segmented">
            <button aria-pressed={printMode === 'simulated'} onClick={() => (setPrintMode('simulated'), dirty())}>
              Simulasi
            </button>
            <button aria-pressed={printMode === 'airprint'} onClick={() => (setPrintMode('airprint'), dirty())}>
              AirPrint (SELPHY)
            </button>
          </div>
        </div>

        {paymentMode === 'qris' && (
          <div className="field-label">
            <span className="mono mono-sm">HARGA (RUPIAH, 0 = GRATIS)</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {[...PACKAGES, ...ADDONS].map((item) => (
                <label key={item.id} className="field-label">
                  <span className="mono mono-sm">{item.label.toUpperCase()}</span>
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

        <label className="checkbox">
          <input type="checkbox" checked={gallery} onChange={(e) => (setGallery(e.target.checked), dirty())} />
          <span style={{ fontSize: 14 }}>Galeri live aktif (tamu bisa memilih tidak ditampilkan)</span>
        </label>

        {error && <div className="notice notice-error">{error}</div>}
        <button className="pill" onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Menyimpan…' : state === 'saved' ? 'Tersimpan ✓' : 'Simpan pengaturan'}
        </button>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <span className="mono">{event.ended_at ? 'GALERI FOTO TERBUKA' : 'SELAMA ACARA: LAYAR KEDUA'}</span>
        <p className="muted" style={{ fontSize: 14 }}>
          {event.ended_at
            ? 'Link acara sekarang menampilkan galeri foto untuk didownload tamu.'
            : 'Link acara menampilkan 3 video live tamu bergantian. Galeri foto dibuka saat acara diakhiri.'}
        </p>
        {event.ended_at ? (
          <button className="pill pill-ghost" onClick={() => setEnded(false)} disabled={ending}>
            {ending ? 'Membuka…' : 'Buka lagi acara (kembali ke layar kedua)'}
          </button>
        ) : confirmEnd ? (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
      </div>

      {event.gallery && (
        <div className="panel" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={galleryQr} alt="QR galeri" style={{ width: 120, height: 120, borderRadius: 12, background: '#fff', padding: 6 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
            <span className="mono">LINK ACARA</span>
            <span className="mono mono-sm" style={{ wordBreak: 'break-all' }}>{galleryUrl}</span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a className="pill pill-ghost pill-sm" href={galleryUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center' }}>
                {event.ended_at ? 'Buka galeri' : 'Buka layar kedua'}
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <span className="mono">MULAI ACARA BARU</span>
        <p className="muted" style={{ fontSize: 14 }}>
          Tamu berikutnya masuk ke acara baru dengan link sendiri. Acara ini otomatis diakhiri dan galerinya dibuka. Harga dan
          pengaturan disalin.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input className="field" placeholder="mis. Nikahan Rina & Dimas" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
          <button className="pill pill-ghost" onClick={startNew} disabled={starting || !newName.trim()} style={{ flex: 'none' }}>
            {starting ? 'Membuat…' : 'Mulai'}
          </button>
        </div>
      </div>
    </div>
  );
}
