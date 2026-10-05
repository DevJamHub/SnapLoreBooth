'use client';

import { useState } from 'react';
import { readJson } from '@/lib/readJson';

/**
 * The red light on the Canon is its AF-assist lamp: it lights whenever the body focuses in a
 * dim room, and by default the booth focuses before every shot. Locked, the body focuses once
 * here and every shot after it fires without focusing: no lamp, and about 0.7 s quicker.
 */
export default function FocusPanel({ locked, onChange }: { locked: boolean; onChange: (locked: boolean) => void }) {
  const [busy, setBusy] = useState<'lock' | 'unlock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const apply = async (next: boolean) => {
    setBusy(next ? 'lock' : 'unlock');
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/camera/focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: next }),
      });
      const data = await readJson<{ focusLocked?: boolean }>(res);
      if (!res.ok || typeof data.focusLocked !== 'boolean') throw new Error(data.error ?? 'kamera tidak menjawab');
      onChange(data.focusLocked);
      setDone(
        next
          ? 'Fokus terkunci. Cek live view: orang di titik tamu harus tajam. Kalau belum, tekan Fokus ulang.'
          : 'Kembali ke fokus otomatis sebelum tiap foto.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kamera tidak menjawab');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <span className="mono">FOKUS · {locked ? 'TERKUNCI' : 'OTOMATIS TIAP FOTO'}</span>
      <p className="muted" style={{ fontSize: 13 }}>
        {locked
          ? 'Setiap foto dijepret tanpa mencari fokus: lampu merah di kamera tidak menyala dan jepretan lebih cepat. Fokus ulang kalau kamera digeser, zoom diubah, atau kamera dimatikan atau ganti baterai.'
          : 'Kamera mencari fokus sebelum tiap foto. Di tempat redup lampu bantu fokus (sinar merah) menyala, dan jepretan sekitar 0,7 detik lebih lambat.'}
      </p>
      <p className="muted" style={{ fontSize: 13 }}>
        Minta satu orang berdiri di titik foto tamu, lalu tekan {locked ? 'Fokus ulang' : 'Kunci fokus'}. Lampu merah bisa menyala
        sekali saat kamera fokus. Bukaan f/5,6–f/8 menjaga rombongan yang berdiri maju-mundur tetap tajam.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="pill" style={{ flex: 1 }} disabled={busy !== null} onClick={() => void apply(true)}>
          {busy === 'lock' ? 'Memfokuskan…' : locked ? 'Fokus ulang' : 'Kunci fokus'}
        </button>
        {locked && (
          <button className="pill pill-ghost" disabled={busy !== null} onClick={() => void apply(false)}>
            {busy === 'unlock' ? 'Mengembalikan…' : 'Otomatis lagi'}
          </button>
        )}
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {done && <div className="notice">{done}</div>}
    </div>
  );
}
