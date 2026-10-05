'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { FoundPrinter, PrinterStatus } from '@/lib/printer';
import { readJson } from '@/lib/readJson';

const RECHECK_MS = 60_000;

const STATE_LABEL: Record<PrinterStatus['state'], string> = {
  idle: 'Siap',
  printing: 'Mencetak',
  stopped: 'Berhenti',
  unknown: 'Tidak diketahui',
};

/**
 * The printer as it reports itself over IPP (state, problems, ink) and the paper count the
 * booth keeps from the last recorded refill.
 */
export default function PrinterPanel({
  paper,
}: {
  paper: { remaining: number; capacity: number; percent: number; loadedAt: string | null };
}) {
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<FoundPrinter[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState(String(paper.capacity));
  const [refilling, setRefilling] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/operator/printer', { cache: 'no-store' });
      const data = await readJson<{ uri: string | null; status: PrinterStatus | null }>(res);
      if (data.error) throw new Error(data.error);
      setUri(data.uri);
      setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'printer tidak terbaca');
    } finally {
      setChecking(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => document.visibilityState === 'visible' && void check(), RECHECK_MS);
    return () => clearInterval(timer);
  }, [check]);

  const choose = async (next: string | null) => {
    setError(null);
    setChecking(true);
    try {
      const res = await fetch('/api/operator/printer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri: next }),
      });
      const data = await readJson<{ uri: string | null; status: PrinterStatus | null }>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan printer');
      setUri(data.uri);
      setStatus(data.status);
      setFound(null);
      setManual('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan printer');
    } finally {
      setChecking(false);
    }
  };

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/printer/discover', { cache: 'no-store' });
      const data = await readJson<{ printers?: FoundPrinter[] }>(res);
      setFound(data.printers ?? []);
    } finally {
      setSearching(false);
    }
  };

  const refill = async () => {
    setRefilling(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheets: Number(sheets) }),
      });
      const data = await readJson<object>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal mencatat');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mencatat');
    } finally {
      setRefilling(false);
    }
  };

  const chip = !loaded
    ? { tone: 'muted', text: 'Memeriksa…' }
    : !uri
      ? { tone: 'muted', text: 'Belum dipilih' }
      : !status?.reachable
        ? { tone: 'bad', text: 'Tidak menjawab' }
        : status.problems.some((p) => p.severity === 'error')
          ? { tone: 'bad', text: 'Perlu dicek' }
          : { tone: status.problems.length ? 'warn' : 'ok', text: STATE_LABEL[status.state] };

  return (
    <section className="op-card">
      <div className="op-card-head">
        <h2>Printer & kertas</h2>
        <span className="op-chip" data-tone={chip.tone}>
          {chip.text}
        </span>
      </div>

      {loaded && !uri && (
        <>
          <p className="op-muted">
            Belum ada printer yang dipantau. Nyalakan printer (mis. Epson L8050), sambungkan ke Wi-Fi yang sama dengan server,
            lalu cari.
          </p>
          <button className="pill pill-ghost" onClick={search} disabled={searching}>
            {searching ? 'Mencari printer…' : 'Cari printer'}
          </button>
        </>
      )}

      {found && (
        <div className="op-list">
          {found.length === 0 ? (
            <p className="op-muted">Tidak ada printer ditemukan. Cek printer menyala dan satu Wi-Fi dengan server.</p>
          ) : (
            found.map((printer) => (
              <div key={printer.uri} className="op-list-row">
                <div>
                  <b>{printer.name}</b>
                  <span className="op-muted">{printer.source === 'jaringan' ? 'Wi-Fi (AirPrint)' : 'Terpasang di server'}</span>
                </div>
                <button className="pill pill-sm" onClick={() => void choose(printer.uri)}>
                  Pakai
                </button>
              </div>
            ))
          )}
          <div className="op-row op-row-fill">
            <input className="field" placeholder="atau ketik ipp://alamat-printer/ipp/print" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button className="pill pill-ghost pill-sm" onClick={() => void choose(manual.trim())} disabled={!manual.trim()}>
              Simpan
            </button>
          </div>
        </div>
      )}

      {uri && status && (
        <>
          <div>
            <b style={{ fontSize: 15 }}>{status.model ?? 'Printer'}</b>
            <span className="op-muted op-ellipsis">{uri}</span>
          </div>
          {status.error && <div className="notice notice-error">{status.error}</div>}
          {status.problems.map((problem) => (
            <div key={problem.code} className={`notice${problem.severity === 'error' ? ' notice-error' : ''}`}>
              {problem.text}
            </div>
          ))}
          {status.reachable &&
            (status.inks.length > 0 ? (
              <div className="op-inks">
                {status.inks.map((ink) => (
                  <div key={ink.name} className="op-ink">
                    <span>{ink.name}</span>
                    <span className="op-meter">
                      <span style={{ width: `${ink.level ?? 0}%`, background: ink.color ?? undefined }} data-low={ink.level !== null && ink.level < 15} />
                    </span>
                    <b>{ink.level === null ? '?' : `${ink.level}%`}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="op-muted">Printer ini tidak melaporkan level tinta. Untuk printer tangki (EcoTank), cek tangkinya langsung.</p>
            ))}
          <div className="op-row">
            <button className="pill pill-ghost pill-sm" onClick={() => void check()} disabled={checking}>
              {checking ? 'Memeriksa…' : 'Periksa sekarang'}
            </button>
            <button className="pill pill-ghost pill-sm" onClick={search} disabled={searching}>
              {searching ? 'Mencari…' : 'Ganti printer'}
            </button>
            <button className="pill pill-ghost pill-sm pill-danger-text" onClick={() => setConfirmRemove(true)} disabled={checking}>
              Lepas
            </button>
          </div>
        </>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Lepas printer dari pemantauan?"
          confirmLabel="Ya, lepas"
          tone="normal"
          busy={checking}
          error={error}
          onConfirm={() => void choose(null).then(() => setConfirmRemove(false))}
          onCancel={() => setConfirmRemove(false)}
        >
          <p>
            Konsol berhenti memantau {status?.model ?? 'printer ini'} (tinta, kertas macet, status). Printernya sendiri tidak
            berubah; pilih lagi kapan saja lewat Cari printer.
          </p>
        </ConfirmDialog>
      )}

      <div className="op-divider" />

      <div className="op-field">
        <span className="op-label">Kertas</span>
        <div className="op-paper">
          <b>±{paper.remaining}</b>
          <span className="op-muted">lembar lagi dari {paper.capacity}</span>
        </div>
        <span className="op-meter">
          <span style={{ width: `${paper.percent}%` }} data-low={paper.percent < 15} />
        </span>
        <span className="op-muted" style={{ fontSize: 12 }}>
          {paper.loadedAt
            ? `Dihitung dari isi ulang ${new Date(paper.loadedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`
            : 'Perkiraan. Catat isi ulang supaya hitungannya tepat.'}
        </span>
      </div>
      <div className="op-row op-row-fill">
        <input className="field" inputMode="numeric" value={sheets} onChange={(e) => setSheets(e.target.value.replace(/\D/g, ''))} aria-label="Jumlah lembar yang diisi" />
        <button className="pill pill-ghost pill-sm" onClick={refill} disabled={refilling || !Number(sheets)}>
          {refilling ? 'Mencatat…' : 'Catat isi ulang'}
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
    </section>
  );
}
