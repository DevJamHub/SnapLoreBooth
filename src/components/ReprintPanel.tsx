'use client';

import { useEffect, useRef, useState } from 'react';
import { STRIP_FORMATS } from '@/lib/packages';
import { readJson } from '@/lib/readJson';

const MAX_COPIES = 10;

/**
 * The sheet, how many copies, and the system print dialog (AirPrint on an iPad or Mac). The
 * copies are recorded once the dialog closes, so the console's paper count includes them.
 */
export default function ReprintPanel({ id, src, format, label }: { id: string; src: string; format: string; label: string }) {
  const [copies, setCopies] = useState(1);
  const [printed, setPrinted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const onAfterPrint = async () => {
      const n = pending.current;
      pending.current = null;
      if (!n) return;
      try {
        const res = await fetch(`/api/operator/sessions/${id}/reprint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ copies: n }),
        });
        const data = await readJson<object>(res);
        if (!res.ok) throw new Error(data.error ?? 'gagal mencatat');
        setPrinted((p) => (p ?? 0) + n);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'gagal mencatat');
      }
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [id]);

  const print = () => {
    setError(null);
    pending.current = copies;
    window.print();
  };

  return (
    <>
      <section className="op-card op-reprint no-print">
        <div className="op-card-head">
          <h2>Cetak ulang · {id}</h2>
          <span className="op-muted">{label}</span>
        </div>
        <div className="op-reprint-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Lembar ${id}`} />
          <div className="op-field">
            <span className="op-label">Jumlah lembar</span>
            <div className="op-row">
              <button className="pill pill-ghost pill-sm" onClick={() => setCopies((n) => Math.max(1, n - 1))} disabled={copies <= 1} aria-label="Kurangi">
                −
              </button>
              <b style={{ fontSize: 22, minWidth: 32, textAlign: 'center' }}>{copies}</b>
              <button className="pill pill-ghost pill-sm" onClick={() => setCopies((n) => Math.min(MAX_COPIES, n + 1))} disabled={copies >= MAX_COPIES} aria-label="Tambah">
                +
              </button>
            </div>
            <p className="op-muted">
              Pilih printer booth di dialog cetak (kertas 4×6 in / 4R, tanpa margin). Setelah dialog ditutup, jumlah lembar dicatat
              ke hitungan kertas.
            </p>
            <button className="pill" onClick={print}>
              Cetak {copies} lembar
            </button>
            {printed !== null && <div className="notice">{printed} lembar tercatat sebagai cetak ulang.</div>}
            {error && <div className="notice notice-error">{error}</div>}
          </div>
        </div>
      </section>

      <div className="print-only" aria-hidden="true">
        {Array.from({ length: copies }, (_, i) => (
          <div key={i} className="print-sheet" data-format={format}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" />
            {STRIP_FORMATS.includes(format) && (
              // A strip prints two-up, the same as on the booth's own print screen.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
