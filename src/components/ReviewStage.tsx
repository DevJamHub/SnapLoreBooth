'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { Printer } from '@/components/guest/icons';
import { FILTERS, TEMPLATES, filterCss } from '@/lib/packages';
import { composeStrip } from '@/lib/strip';
import type { Photo, Session } from '@/lib/types';

const AUTO_CONTINUE_SECONDS = 60;

export default function ReviewStage({
  session,
  photos,
  payments,
  eventName,
}: {
  session: Session;
  photos: Photo[];
  payments: boolean;
  eventName: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState(FILTERS.some((f) => f.id === session.filter) ? session.filter : 'original');
  const [template, setTemplate] = useState(TEMPLATES.some((t) => t.id === session.template) ? session.template : TEMPLATES[0].id);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitRef = useRef<() => void>(() => {});

  const sources = useMemo(
    () => photos.map((p) => `/api/media/${p.file.split('/').map(encodeURIComponent).join('/')}`),
    [photos],
  );

  // Re-compose on every choice so the board on screen is exactly the board that prints.
  useEffect(() => {
    let cancelled = false;
    composeStrip(sources, {
      format: session.format,
      filterId: filter,
      templateId: template,
      eventName,
      capturedAt: new Date(session.created_at),
    })
      .then((dataUrl) => !cancelled && setPreview(dataUrl))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [sources, filter, template, eventName, session.format, session.created_at]);

  const submit = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, template }),
      });
      const res = await fetch(`/api/sessions/${session.id}/strip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: preview }),
      });
      if (!res.ok) throw new Error();
      router.push(`/share/${session.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  submitRef.current = () => void submit();

  // A guest who wanders off still gets their print.
  const left = useCountdown(AUTO_CONTINUE_SECONDS, !busy, () => submitRef.current());

  return (
    <main className="g-screen">
      <GuestHeader step="gaya" payments={payments} />

      <div className="rv-layout">
        <div className="rv-board">
          <div className="fit">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={preview.length} src={preview} alt="Pratinjau hasil cetak" />
            ) : (
              <span className="g-lead">Menyusun fotomu…</span>
            )}
          </div>
        </div>

        <div className="rv-side">
          <div>
            <span className="g-kicker">Hampir jadi</span>
            <h1 className="g-title" style={{ marginTop: 8 }}>Hias fotomu</h1>
          </div>

          <section>
            <div className="rv-label">Warna</div>
            <div className="rv-options">
              {FILTERS.map((f) => (
                <button key={f.id} className="rv-option" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  <span className="rv-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sources[0]} alt="" style={{ filter: filterCss(f.id) }} />
                  </span>
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="rv-label">Bingkai</div>
            <div className="rv-options">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="rv-option" aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>
                  <span className="rv-thumb">
                    <span className="rv-swatch" style={{ background: t.board, padding: `${10 * t.border + 6}% ${12 * t.border + 6}% 8%` }}>
                      <b />
                      {t.eventMark && <u style={{ background: t.ink }} />}
                    </span>
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          {failed && <div className="g-error">Fotomu belum bisa disimpan. Coba tekan Cetak lagi, atau panggil petugas.</div>}
        </div>
      </div>

      <div className="g-bar">
        <div>
          <div className="g-bar-label">Lanjut otomatis dalam</div>
          <div className="g-bar-value">{formatClock(left)}</div>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={submit} disabled={busy || !preview}>
          <Printer /> {busy ? 'Mengirim ke printer…' : 'Cetak sekarang'}
        </button>
      </div>
    </main>
  );
}
