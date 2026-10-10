'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { Contact } from '@/lib/contacts';
import { readJson } from '@/lib/readJson';

type Row = Contact & { event_name: string | null };

/** Konsol → Laporan: contacts guests left with consent, to download or delete (each asked first). */
export default function ContactsPanel({ contacts, total, confirmWord }: { contacts: Row[]; total: number; confirmWord: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<Row | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/contacts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target === 'all' ? { all: true, confirm: confirmWord } : { id: target.id }),
      });
      const data = await readJson<{ deleted?: number }>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal menghapus');
      setTarget(null);
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
        <h2>Kontak tamu</h2>
        <span className="op-muted">{total} kontak</span>
      </div>
      <p className="op-muted">
        Ditinggalkan tamu di halaman QR, dengan persetujuan untuk dihubungi. Tidak ikut terhapus bersama foto; hapus kalau tamu memintanya.
      </p>
      {contacts.length === 0 ? (
        <p className="op-muted">Belum ada.</p>
      ) : (
        <div className="op-list">
          {contacts.map((c) => (
            <div key={c.id} className="op-list-row op-promo-row">
              <div>
                <b>{c.name}</b>
                <span className="op-muted">
                  {[c.phone, c.instagram && `@${c.instagram}`, c.answer, new Date(c.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button className="pill pill-ghost pill-sm pill-danger-text" onClick={() => setTarget(c)}>
                Hapus
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="op-row">
        <a className="pill pill-sm" href="/api/operator/export?kind=contacts" aria-disabled={total === 0}>
          Unduh semua (CSV)
        </a>
        {total > 0 && (
          <button className="pill pill-ghost pill-sm pill-danger-text" onClick={() => setTarget('all')}>
            Hapus semua kontak…
          </button>
        )}
      </div>

      {target && (
        <ConfirmDialog
          title={target === 'all' ? `Hapus semua ${total} kontak?` : `Hapus kontak ${target.name}?`}
          confirmLabel="Hapus"
          typeWord={target === 'all' ? confirmWord : null}
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setTarget(null)}
        >
          <p>{target === 'all' ? 'Semua kontak tamu dihapus permanen. Unduh CSV dulu kalau masih perlu.' : 'Kontak ini dihapus permanen, mis. atas permintaan tamu.'}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
