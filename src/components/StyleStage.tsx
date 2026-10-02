'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { ArrowLeft, ArrowRight } from '@/components/guest/icons';
import { FILTERS, TEMPLATES, filterCss } from '@/lib/packages';
import { composeStrip, placeholderCanvas } from '@/lib/strip';
import type { CustomFrame, Session } from '@/lib/types';

/** Time to choose a frame and a look; the choice on screen is kept when it runs out. */
const STYLE_SECONDS = 5 * 60;

/** The frame shown first: one already chosen, else the newest uploaded frame, else Klasik. */
function initialTemplate(session: Session, frames: CustomFrame[]): string {
  if (frames.some((f) => f.id === session.template)) return session.template;
  if (frames.length > 0) return frames[0].id;
  return TEMPLATES.some((t) => t.id === session.template) ? session.template : TEMPLATES[0].id;
}

export default function StyleStage({
  session,
  payments,
  eventName,
  frames,
}: {
  session: Session;
  payments: boolean;
  eventName: string;
  frames: CustomFrame[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState(FILTERS.some((f) => f.id === session.filter) ? session.filter : 'original');
  const [template, setTemplate] = useState(() => initialTemplate(session, frames));
  const frame = frames.find((f) => f.id === template) ?? null;
  const [preview, setPreview] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const continueRef = useRef<() => void>(() => {});

  useEffect(() => {
    setSample(placeholderCanvas(0, 240, 240).toDataURL('image/jpeg', 0.85));
  }, []);

  // No photos yet: the preview shows the chosen frame and look on stand-in silhouettes.
  useEffect(() => {
    let cancelled = false;
    composeStrip(
      Array.from({ length: session.shots }, () => null),
      { format: session.format, filterId: filter, templateId: template, eventName, capturedAt: new Date(), frame },
      0.8,
    )
      .then((url) => !cancelled && setPreview(url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [filter, template, frame, eventName, session.format, session.shots]);

  const next = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, template }),
      });
      if (!res.ok) throw new Error();
      router.push(session.requires_payment ? `/pay/${session.id}` : `/capture/${session.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  continueRef.current = () => void next();

  const left = useCountdown(STYLE_SECONDS, !busy, () => continueRef.current());

  return (
    <main className="g-screen">
      <GuestHeader
        step="gaya"
        payments={payments}
        left={
          <button className="g-ghost" onClick={() => router.replace('/paket')} disabled={busy}>
            <ArrowLeft /> Ganti paket
          </button>
        }
      />

      <div className="rv-layout">
        <div className="rv-board">
          <div className="fit">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${filter}-${template}`} src={preview} alt="Pratinjau frame" />
            ) : (
              <span className="g-lead">Menyiapkan frame…</span>
            )}
          </div>
        </div>

        <div className="rv-side">
          <div>
            <span className="g-kicker">{session.package_label} · {session.prints} lembar</span>
            <h1 className="g-title" style={{ marginTop: 8 }}>Pilih frame & gaya</h1>
          </div>

          <section>
            <div className="rv-label">Bingkai</div>
            <div className="rv-options">
              {frames.map((f) => (
                <button key={f.id} className="rv-option" aria-pressed={template === f.id} onClick={() => setTemplate(f.id)}>
                  <span className="rv-thumb rv-thumb-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.src} alt="" />
                  </span>
                  <span className="rv-name">{f.name}</span>
                </button>
              ))}
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

          <section>
            <div className="rv-label">Gaya warna</div>
            <div className="rv-options">
              {FILTERS.map((f) => (
                <button key={f.id} className="rv-option" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  <span className="rv-thumb">
                    {sample && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sample} alt="" style={{ filter: filterCss(f.id) }} />
                    )}
                  </span>
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          {failed && <div className="g-error">Pilihanmu belum tersimpan. Coba tekan Lanjut lagi, atau panggil petugas.</div>}
        </div>
      </div>

      <div className="g-bar">
        <div>
          <div className="g-bar-label">Sisa waktu memilih</div>
          <div className="g-bar-value">{formatClock(left)}</div>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={next} disabled={busy}>
          {busy ? 'Menyimpan…' : payments ? 'Lanjut bayar' : 'Mulai foto'} <ArrowRight />
        </button>
      </div>
    </main>
  );
}
