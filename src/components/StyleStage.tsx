'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { ArrowRight } from '@/components/guest/icons';
import { BEAUTY, FILTERS, filterCss } from '@/lib/packages';
import { composeStrip, type StripOptions } from '@/lib/strip';
import type { CustomFrame, Session } from '@/lib/types';

const SAMPLE_SIZE = 240;

/** The guest's first photo, square, as they saw it: the swatch every look is shown on. */
function sampleOf(src: string, mirror: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext('2d')!;
      const side = Math.min(img.width, img.height);
      if (mirror) {
        ctx.translate(SAMPLE_SIZE, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('sample failed'));
    img.src = src;
  });
}

export default function StyleStage({
  session,
  payments,
  eventName,
  photos,
  frame,
  settings,
  showDate,
}: {
  session: Session;
  payments: boolean;
  eventName: string;
  /** Every shot, in slot order. */
  photos: string[];
  frame: CustomFrame | null;
  /** What the operator offers here (Konsol → Pengaturan → Gaya & beauty). */
  settings: {
    /** Time to choose; the choice on screen prints when it runs out. */
    seconds: number;
    filters: string[];
    beauty: boolean;
  };
  showDate: boolean;
}) {
  const router = useRouter();
  const looks = FILTERS.filter((f) => settings.filters.includes(f.id));
  // With one look and no beauty there is nothing to choose: the sheet is made and printed.
  const nothingToChoose = looks.length <= 1 && !settings.beauty;
  const [filter, setFilter] = useState(looks.some((f) => f.id === session.filter) ? session.filter : 'original');
  const [beauty, setBeauty] = useState(settings.beauty && BEAUTY.some((b) => b.id === session.beauty) ? session.beauty : 'off');
  const [preview, setPreview] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [composing, setComposing] = useState(true);
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const continueRef = useRef<() => void>(() => {});
  const composed = useRef(0);

  const optionsFor = (filterId: string, beautyId: string): StripOptions => ({
    format: session.format,
    filterId,
    templateId: session.template,
    eventName,
    capturedAt: new Date(session.created_at),
    frame,
    mirror: session.mirror,
    beauty: beautyId,
    showDate,
  });
  const optionsRef = useRef(optionsFor);
  optionsRef.current = optionsFor;

  useEffect(() => {
    sampleOf(photos[0], session.mirror).then(setSample, () => undefined);
    // Held down on the preview, the sheet shows the photos as they were shot.
    composeStrip(photos, optionsRef.current('original', 'off'), 0.8).then(setOriginal, () => undefined);
  }, [photos, session.mirror]);

  // The preview is the print itself, recomposed for every choice. Only the newest one shows.
  useEffect(() => {
    const mine = ++composed.current;
    setComposing(true);
    composeStrip(photos, optionsRef.current(filter, beauty), 0.8)
      .then((url) => mine === composed.current && setPreview(url))
      .catch(() => undefined)
      .finally(() => mine === composed.current && setComposing(false));
  }, [filter, beauty, photos]);

  const next = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, beauty }),
      });
      if (!res.ok) throw new Error();
      const dataUrl = await composeStrip(photos, optionsRef.current(filter, beauty));
      const saved = await fetch(`/api/sessions/${session.id}/strip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!saved.ok) throw new Error();
      router.push(`/share/${session.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  continueRef.current = () => void next();

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!nothingToChoose || autoStarted.current) return;
    autoStarted.current = true;
    continueRef.current();
  }, [nothingToChoose]);

  const left = useCountdown(settings.seconds, !busy && !nothingToChoose, () => continueRef.current());
  const shown = comparing && original ? original : preview;
  const stopComparing = () => setComparing(false);

  return (
    <main className="g-screen">
      <GuestHeader step="gaya" payments={payments} />

      <div className="rv-layout">
        <div
          className="rv-board st-board"
          onPointerDown={() => setComparing(true)}
          onPointerUp={stopComparing}
          onPointerLeave={stopComparing}
          onPointerCancel={stopComparing}
        >
          <div className="fit">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt={comparing ? 'Foto asli' : 'Pratinjau hasil cetak'} draggable={false} />
            ) : (
              <span className="g-lead">Menyusun fotomu…</span>
            )}
          </div>
          {shown && (
            <span className="st-hint" data-on={comparing}>
              {comparing ? 'Foto asli' : composing ? 'Menerapkan…' : 'Tahan untuk lihat aslinya'}
            </span>
          )}
        </div>

        <div className="rv-side">
          <div>
            <span className="g-kicker">Foto selesai · {session.shots} pose</span>
            <h1 className="g-title" style={{ marginTop: 8 }}>
              {nothingToChoose ? 'Menyusun fotomu…' : 'Pilih gaya'}
            </h1>
          </div>

          <section hidden={looks.length <= 1}>
            <div className="rv-label">Gaya warna</div>
            <div className="rv-options">
              {looks.map((f) => (
                <button key={f.id} className="rv-option" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} disabled={busy}>
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

          <section hidden={!settings.beauty}>
            <div className="rv-label">Mode beauty</div>
            <div className="st-beauty" role="radiogroup" aria-label="Mode beauty">
              {BEAUTY.map((b) => (
                <button key={b.id} role="radio" aria-checked={beauty === b.id} onClick={() => setBeauty(b.id)} disabled={busy}>
                  <b>{b.label}</b>
                  <small>{b.blurb}</small>
                </button>
              ))}
            </div>
          </section>

          {failed && <div className="g-error">Fotomu belum tersimpan. Coba tekan Cetak lagi, atau panggil petugas.</div>}
        </div>
      </div>

      <div className="g-bar">
        <div>
          <div className="g-bar-label">Sisa waktu memilih</div>
          <div className="g-bar-value">{formatClock(left)}</div>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={next} disabled={busy || !preview}>
          {busy ? 'Menyimpan…' : 'Cetak sekarang'} <ArrowRight />
        </button>
      </div>
    </main>
  );
}
