'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatBytes, formatRetention } from '@/lib/format';

/** Shows what guest data the booth holds, and wipes it behind a typed confirmation. */
export default function GuestDataPanel({
  sessions,
  bytes,
  retentionHours,
  confirmWord,
}: {
  sessions: number;
  bytes: number;
  retentionHours: number;
  /** The word the operator must type; the API checks it too. */
  confirmWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const confirmed = typed.trim().toUpperCase() === confirmWord;

  const close = () => {
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const purge = async () => {
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmWord }),
      });
      const data = (await res.json()) as { deleted?: number; kept?: number; failed?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menghapus');
      const parts = [`${data.deleted ?? 0} sesi tamu dihapus.`];
      if (data.kept) parts.push(`${data.kept} sesi yang sedang berjalan dibiarkan, hapus lagi nanti setelah selesai.`);
      if (data.failed) parts.push(`${data.failed} sesi gagal dihapus dari cloud dan akan dicoba lagi otomatis.`);
      setResult(parts.join(' '));
      close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menghapus');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="op-card">
      <div className="op-card-head">
        <h2>Data tamu</h2>
      </div>
      <p style={{ fontSize: 14 }}>
        <b>{sessions} sesi</b> · {formatBytes(bytes)} foto & video tersimpan di booth ini.
      </p>
      <p className="op-muted">
        Terhapus otomatis {formatRetention(retentionHours)} setelah sesi dibuat.{' '}
        <a href="/operator/pengaturan#set-storage" style={{ color: 'var(--primary)' }}>
          Atur penyimpanan
        </a>
      </p>

      {result && <div className="notice">{result}</div>}

      {open ? (
        <>
          <div className="notice notice-error" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <b>Peringatan: tidak bisa dibatalkan</b>
            <span>
              Semua foto, video, dan riwayat sesi tamu akan dihapus permanen. Link QR yang sudah dipindai tamu dan galeri acara
              jadi kosong. Statistik hari ini kembali ke 0.
            </span>
            <span>
              Yang tetap ada: acara, harga, frame, dan catatan pembayaran di dashboard Xendit. Tamu yang sedang memakai booth
              tidak ikut dihapus.
            </span>
          </div>
          <label className="field-label">
            <span className="mono mono-sm">KETIK {confirmWord} UNTUK KONFIRMASI</span>
            <input
              className="field"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={confirmWord}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="pill pill-danger" onClick={purge} disabled={!confirmed || busy} style={{ flex: 1 }}>
              {busy ? 'Menghapus…' : 'Hapus permanen'}
            </button>
            <button className="pill pill-ghost" onClick={close} disabled={busy}>
              Batal
            </button>
          </div>
        </>
      ) : (
        <button
          className="pill pill-ghost pill-danger-text"
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
          disabled={sessions === 0 && bytes === 0}
        >
          Hapus semua foto tamu…
        </button>
      )}

      {error && <div className="notice notice-error">{error}</div>}
    </section>
  );
}
