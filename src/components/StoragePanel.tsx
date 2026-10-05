'use client';

import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatBytes } from '@/lib/format';
import type { OptimizeResult, StorageBreakdown } from '@/lib/housekeeping';
import { readJson } from '@/lib/readJson';

const PARTS: { key: keyof StorageBreakdown; label: string; color: string }[] = [
  { key: 'clips', label: 'Video per foto', color: '#cc785c' },
  { key: 'live', label: 'Video satu lembar', color: '#e0a878' },
  { key: 'photos', label: 'Foto', color: '#8fae82' },
  { key: 'sheets', label: 'Lembar jadi', color: '#9bb0d6' },
  { key: 'frames', label: 'Frame', color: '#b9a0d0' },
  { key: 'tests', label: 'Foto tes kamera', color: '#a8a29e' },
  { key: 'other', label: 'Sisa sesi terhapus', color: '#6e6259' },
  { key: 'database', label: 'Database', color: '#5b3f33' },
];

/** Where the disk goes, and one button that gives back what the booth no longer needs. */
export default function StoragePanel({ initial }: { initial: StorageBreakdown }) {
  const [usage, setUsage] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/storage', { method: 'POST' });
      const data = await readJson<Partial<OptimizeResult>>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal mengoptimalkan');
      const parts = [`${formatBytes(data.freed ?? 0)} dibebaskan.`];
      if (data.stills) parts.push(`${data.stills} foto kamera diperkecil (${formatBytes(data.stillBytes ?? 0)}).`);
      if (data.videosExpired) parts.push(`Video ${data.videosExpired} sesi lewat batas simpan dihapus.`);
      if (data.sessionsExpired) parts.push(`${data.sessionsExpired} sesi lewat batas simpan dihapus.`);
      if (data.leftovers) parts.push(`${data.leftovers} folder tes/sisa dibersihkan.`);
      if (data.stillsUnchecked) parts.push(`${data.stillsUnchecked} foto belum diperiksa — jalankan sekali lagi.`);
      setResult(parts.join(' '));
      setConfirm(false);
      const next = await fetch('/api/operator/storage', { cache: 'no-store' });
      if (next.ok) setUsage((await next.json()) as StorageBreakdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mengoptimalkan');
    } finally {
      setBusy(false);
    }
  };

  const total = Math.max(usage.total, 1);

  return (
    <div className="op-storage">
      <div className="op-storage-head">
        <div>
          <span className="op-label">Terpakai</span>
          <b>{formatBytes(usage.total)}</b>
          <span className="op-muted">
            {usage.sessions} sesi{usage.free !== null ? ` · sisa disk ${formatBytes(usage.free)}` : ''}
          </span>
        </div>
        <button type="button" className="pill pill-sm" onClick={() => (setConfirm(true), setResult(null))}>
          Optimalkan sekarang…
        </button>
      </div>
      <div className="op-storage-bar" aria-hidden="true">
        {PARTS.map((p) => (usage[p.key] as number) > 0 && <span key={p.key} style={{ width: `${((usage[p.key] as number) / total) * 100}%`, background: p.color }} />)}
      </div>
      <ul className="op-storage-legend">
        {PARTS.filter((p) => (usage[p.key] as number) > 0).map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            {p.label}
            <b>{formatBytes(usage[p.key] as number)}</b>
          </li>
        ))}
      </ul>
      {result && <div className="notice">{result}</div>}

      {confirm && (
        <ConfirmDialog
          title="Optimalkan penyimpanan sekarang?"
          confirmLabel="Ya, optimalkan"
          tone="normal"
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onCancel={() => setConfirm(false)}
        >
          <ul className="op-dialog-list">
            <li>Sesi dan video yang lewat batas simpan dihapus sekarang (tidak menunggu jadwal).</li>
            <li>Foto tes kamera dan folder sisa sesi yang sudah dihapus dibersihkan.</li>
            <li>Foto kamera yang lebih besar dari ukuran di atas diperkecil. Lembar yang sudah dicetak tidak berubah.</li>
            <li>Database dirapikan.</li>
          </ul>
          <p className="op-muted">Foto tamu yang masih dalam batas simpan tetap ada. Bisa makan waktu beberapa menit.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
