'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { readJson } from '@/lib/readJson';

export interface PastEvent {
  id: string;
  name: string;
  slug: string;
  /** "12 Okt – 13 Okt", formatted on the server. */
  when: string;
  sessions: number;
}

/** Events before the running one: open their gallery, or delete one with all its photos. */
export default function EventArchive({ events, confirmWord }: { events: PastEvent[]; confirmWord: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<PastEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // After the last one is deleted the card stays for its confirmation, then goes on the next visit.
  if (events.length === 0 && !result) return null;

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/events/${target.id}`, { method: 'DELETE' });
      const data = await readJson<{ deleted?: number; failed?: number }>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal menghapus acara');
      setResult(
        data.failed
          ? `${data.failed} sesi gagal dihapus dari cloud; acara "${target.name}" tetap ada dan bisa dihapus lagi nanti.`
          : `Acara "${target.name}" dan ${data.deleted ?? 0} sesinya dihapus.`,
      );
      setTarget(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menghapus acara');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="op-card">
      <div className="op-card-head">
        <h2>Acara sebelumnya</h2>
        <span className="op-muted">{events.length}</span>
      </div>
      {result && <div className="notice">{result}</div>}
      <div className="op-list">
        {events.map((event) => (
          <div key={event.id} className="op-list-row">
            <div style={{ minWidth: 0 }}>
              <b className="op-ellipsis">{event.name}</b>
              <span className="op-muted">
                {event.when} · {event.sessions} sesi
              </span>
            </div>
            <div className="op-row" style={{ flexWrap: 'nowrap' }}>
              <a className="pill pill-ghost pill-sm" href={`/g/${event.slug}`} target="_blank" rel="noreferrer">
                Galeri
              </a>
              {event.sessions > 0 && (
                <a className="pill pill-ghost pill-sm" href={`/api/operator/export?kind=zip&event=${event.id}`} title="Unduh semua lembar jadi acara ini">
                  ZIP
                </a>
              )}
              <button
                className="pill pill-ghost pill-sm pill-danger-text"
                onClick={() => {
                  setError(null);
                  setResult(null);
                  setTarget(event);
                }}
              >
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>

      {target && (
        <ConfirmDialog
          title={`Hapus acara "${target.name}"?`}
          confirmLabel={target.sessions ? `Ya, hapus acara & ${target.sessions} sesi` : 'Ya, hapus acara'}
          typeWord={target.sessions > 0 ? confirmWord : null}
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => !busy && setTarget(null)}
        >
          <p>
            {target.sessions > 0
              ? `${target.sessions} sesi foto acara ini ikut dihapus permanen: foto, video, dan halaman QR-nya. `
              : 'Acara ini belum punya sesi. '}
            Link galeri acara tidak berlaku lagi.
          </p>
          <p className="op-muted">Acara yang sedang berjalan, harga, dan frame tidak tersentuh.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
