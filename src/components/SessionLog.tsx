'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { readJson } from '@/lib/readJson';

/** One row, already formatted on the server so the console and the server agree on the time. */
export interface LogRow {
  id: string;
  time: string;
  /** The date, for rows not from today. */
  day: string | null;
  price: string;
  requiresPayment: boolean;
  paid: boolean;
  inGallery: boolean;
  /** A guest may still be at the booth with it. */
  active: boolean;
  /** The sheet is made: it can be printed again. */
  done: boolean;
}

type Action = 'delete' | 'hide' | 'show' | 'cash';

const SHOWN_CODES = 12;

function Payment({ row }: { row: LogRow }) {
  if (!row.requiresPayment) return <span className="pay" data-state="free">Gratis</span>;
  return (
    <span className="pay" data-state={row.paid ? 'paid' : 'unpaid'}>
      <b>{row.price}</b>
      <i>{row.paid ? 'Lunas' : 'Belum bayar'}</i>
    </span>
  );
}

/**
 * The session log, with the operator's tools on it: tick one session, a few, or all shown,
 * then take them out of the gallery, put them back, or delete them. Every action asks first.
 */
export default function SessionLog({
  rows,
  summary,
  confirmWord,
  bulkFrom,
  search,
}: {
  rows: LogRow[];
  summary: string;
  /** The code being searched for, from the address bar. */
  search: string;
  /** Typed to delete `bulkFrom` sessions or more at once; the API checks it too. */
  confirmWord: string;
  bulkFrom: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const [includeActive, setIncludeActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(search);

  const find = (value: string) => {
    const q = value.trim();
    router.replace(q ? `/operator?q=${encodeURIComponent(q)}` : '/operator', { scroll: false });
  };

  // The log refreshes itself; a session deleted elsewhere drops out of the selection.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => rows.some((r) => r.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const chosen = rows.filter((r) => selected.has(r.id));
  const activeChosen = chosen.filter((r) => r.active);
  const allChosen = rows.length > 0 && chosen.length === rows.length;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = (next: Action) => {
    setAction(next);
    setIncludeActive(false);
    setError(null);
    setResult(null);
  };
  const close = () => {
    if (!busy) setAction(null);
  };

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    const ids = chosen.map((r) => r.id);
    try {
      if (action === 'cash') {
        const res = await fetch(`/api/operator/sessions/${ids[0]}/cash`, { method: 'POST' });
        const data = await readJson<object>(res);
        if (!res.ok) throw new Error(data.error ?? 'gagal mencatat pembayaran');
        setResult(`Sesi ${ids[0]} tercatat lunas (tunai). Layar booth lanjut ke foto dalam beberapa detik.`);
      } else if (action === 'delete') {
        const res = await fetch('/api/operator/sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, includeActive, confirm: ids.length >= bulkFrom ? confirmWord : undefined }),
        });
        const data = await readJson<{ deleted?: number; kept?: number; failed?: number }>(res);
        if (!res.ok) throw new Error(data.error ?? 'gagal menghapus');
        const parts = [`${data.deleted ?? 0} sesi dihapus.`];
        if (data.kept) parts.push(`${data.kept} sesi yang sedang berjalan dibiarkan.`);
        if (data.failed) parts.push(`${data.failed} sesi gagal dihapus dari cloud dan akan dicoba lagi otomatis.`);
        setResult(parts.join(' '));
      } else {
        const res = await fetch('/api/operator/sessions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, in_gallery: action === 'show' }),
        });
        const data = await readJson<{ updated?: number }>(res);
        if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan');
        setResult(action === 'show' ? `${data.updated ?? 0} sesi tampil lagi di galeri.` : `${data.updated ?? 0} sesi dikeluarkan dari galeri.`);
      }
      setSelected(new Set());
      setAction(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal');
    } finally {
      setBusy(false);
    }
  };

  const codes = (
    <div className="op-codes">
      {chosen.slice(0, SHOWN_CODES).map((r) => (
        <span key={r.id} className="op-code">
          {r.id}
        </span>
      ))}
      {chosen.length > SHOWN_CODES && <span className="op-muted">+{chosen.length - SHOWN_CODES} lagi</span>}
    </div>
  );

  return (
    <section className="op-card op-log">
      <div className="op-card-head">
        <h2>Sesi</h2>
        <span className="op-muted">{summary}</span>
      </div>
      <form
        className="op-row op-row-fill"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          find(query);
        }}
      >
        <input
          className="field"
          type="search"
          value={query}
          maxLength={12}
          placeholder="Cari kode sesi, mis. SB7K2"
          aria-label="Cari kode sesi"
          autoCapitalize="characters"
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) find('');
          }}
        />
        <button className="pill pill-ghost pill-sm" type="submit">
          Cari
        </button>
      </form>

      {chosen.length > 0 && (
        <div className="op-select-bar">
          <b>{chosen.length} dipilih</b>
          <span style={{ flex: 1 }} />
          {chosen.length === 1 && chosen[0].requiresPayment && !chosen[0].paid && (
            <button className="pill pill-ghost pill-sm" onClick={() => open('cash')}>
              Tandai lunas (tunai)…
            </button>
          )}
          {chosen.length === 1 && chosen[0].done && (
            <a className="pill pill-ghost pill-sm" href={`/operator/cetak/${chosen[0].id}`} target="_blank" rel="noreferrer">
              Cetak ulang
            </a>
          )}
          <button className="pill pill-ghost pill-sm" onClick={() => open('hide')}>
            Keluarkan dari galeri
          </button>
          <button className="pill pill-ghost pill-sm" onClick={() => open('show')}>
            Masukkan ke galeri
          </button>
          <button className="pill pill-danger pill-sm" onClick={() => open('delete')}>
            Hapus…
          </button>
          <button className="pill pill-ghost pill-sm" onClick={() => setSelected(new Set())}>
            Batal pilih
          </button>
        </div>
      )}
      {result && <div className="notice">{result}</div>}

      {rows.length === 0 ? (
        <p className="op-empty">{search ? `Tidak ada sesi dengan kode “${search}”.` : 'Belum ada sesi. Booth siap dipakai.'}</p>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th className="op-check">
                <input
                  ref={allRef}
                  type="checkbox"
                  aria-label="Pilih semua sesi yang tampil"
                  checked={allChosen}
                  onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th>Jam</th>
              <th>Kode</th>
              <th className="op-num">Pembayaran</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-selected={selected.has(row.id)}>
                <td className="op-check">
                  <input type="checkbox" aria-label={`Pilih sesi ${row.id}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                </td>
                <td className="op-time">
                  {row.time}
                  {row.day && <small>{row.day}</small>}
                </td>
                <td>
                  <a className="op-code" href={`/d/${row.id}`} target="_blank" rel="noreferrer" title="Buka halaman foto tamu">
                    {row.id}
                  </a>
                  {row.active && <span className="op-tag" data-tone="ok">berjalan</span>}
                  {!row.inGallery && <span className="op-tag">di luar galeri</span>}
                </td>
                <td className="op-num">
                  <Payment row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {action === 'delete' && (
        <ConfirmDialog
          title={`Hapus ${chosen.length} sesi permanen?`}
          confirmLabel={`Ya, hapus ${chosen.length} sesi`}
          typeWord={chosen.length >= bulkFrom ? confirmWord : null}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onCancel={close}
        >
          {codes}
          <p>
            Foto, video, dan halaman QR sesi ini dihapus dan tidak bisa dikembalikan. Tamu yang sudah scan QR tidak bisa download
            lagi, dan sesinya hilang dari galeri acara.
          </p>
          <p className="op-muted">
            Pendapatan & statistik di konsol ikut berkurang. Catatan pembayaran di dashboard Xendit tetap ada.
          </p>
          {activeChosen.length > 0 && (
            <div className="notice notice-error" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>
                {activeChosen.length} sesi masih berjalan: tamunya mungkin sedang di booth. Tanpa centang di bawah, sesi itu
                dibiarkan.
              </span>
              <label className="checkbox">
                <input type="checkbox" checked={includeActive} onChange={(e) => setIncludeActive(e.target.checked)} />
                <span>Ikut hapus {activeChosen.length} sesi yang sedang berjalan</span>
              </label>
            </div>
          )}
        </ConfirmDialog>
      )}
      {action === 'cash' && chosen[0] && (
        <ConfirmDialog
          title={`Tandai ${chosen[0].id} lunas (tunai)?`}
          confirmLabel={`Ya, terima ${chosen[0].price}`}
          tone="normal"
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onCancel={close}
        >
          <p>
            Pastikan tamu sudah membayar <b>{chosen[0].price}</b> tunai. Sesi dibuka: layar booth yang menunggu QRIS langsung lanjut
            ke foto.
          </p>
          <p className="op-muted">Tercatat di pendapatan dan laporan sebagai pembayaran tunai. QRIS yang belum dibayar diabaikan.</p>
        </ConfirmDialog>
      )}
      {action === 'hide' && (
        <ConfirmDialog
          title={`Keluarkan ${chosen.length} sesi dari galeri?`}
          confirmLabel="Ya, keluarkan"
          tone="normal"
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onCancel={close}
        >
          {codes}
          <p>
            Foto sesi ini tidak tampil lagi di galeri acara dan layar kedua. Fotonya tetap tersimpan; tamu masih bisa download lewat
            QR. Bisa dimasukkan lagi kapan saja.
          </p>
        </ConfirmDialog>
      )}
      {action === 'show' && (
        <ConfirmDialog
          title={`Masukkan ${chosen.length} sesi ke galeri?`}
          confirmLabel="Ya, masukkan"
          tone="normal"
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onCancel={close}
        >
          {codes}
          <p>Foto sesi ini tampil di galeri acara dan layar kedua (hanya sesi yang fotonya sudah jadi).</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
