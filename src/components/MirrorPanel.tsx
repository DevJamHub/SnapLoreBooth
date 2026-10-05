'use client';

import { useState } from 'react';

/**
 * Whether new sessions start mirrored. Guests can switch it themselves on the photo screen;
 * either way it flips the preview and the result together, so what a guest sees is what
 * prints. An event setting, so it reaches the kiosk from whichever device sets it.
 */
export default function MirrorPanel({ mirror, onChange }: { mirror: boolean; onChange: (mirror: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const save = async (next: boolean) => {
    onChange(next);
    setState('saving');
    try {
      const res = await fetch('/api/operator/event', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mirror: next }),
      });
      if (!res.ok) throw new Error();
      setState('saved');
    } catch {
      onChange(!next);
      setState('failed');
    }
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <span className="mono">MODE CERMIN · AWAL SESI</span>
      <label className="checkbox">
        <input type="checkbox" checked={mirror} disabled={state === 'saving'} onChange={(e) => void save(e.target.checked)} />
        <span style={{ fontSize: 14 }}>Sesi baru mulai dengan mode cermin</span>
      </label>
      <p className="muted" style={{ fontSize: 13 }}>
        {mirror
          ? 'Tamu melihat dirinya seperti di cermin, dan hasil cetak ikut dibalik.'
          : 'Tanpa cermin: yang tampil di layar sama persis dengan hasil cetak.'}{' '}
        Tamu tetap bisa mengubahnya sendiri di layar Foto; preview dan hasil selalu sama. Berlaku untuk sesi berikutnya.
      </p>
      {state === 'saved' && <span className="mono mono-sm">TERSIMPAN ✓</span>}
      {state === 'failed' && <div className="notice notice-error">Gagal menyimpan. Coba lagi.</div>}
    </div>
  );
}
