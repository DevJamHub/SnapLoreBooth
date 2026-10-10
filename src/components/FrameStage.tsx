'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { useLang, useT } from '@/components/guest/lang';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { ArrowLeft, ArrowRight } from '@/components/guest/icons';
import { useCameraPreview } from '@/components/guest/useCameraPreview';
import { BUILTIN_THEME, TEMPLATES, UNSORTED_THEME, type BoothTemplate } from '@/lib/packages';
import { liveBoard, type LiveBoard } from '@/lib/strip';
import type { CustomFrame, Session } from '@/lib/types';

/** The live preview is drawn at half the print size and this often: plenty for framing. */
const LIVE_SCALE = 0.5;
const LIVE_FPS = 20;

interface Choice {
  id: string;
  name: string;
  /** An uploaded frame, or else the built-in template. */
  frame: CustomFrame | null;
  template: BoothTemplate | null;
}

interface Theme {
  name: string;
  choices: Choice[];
}

/**
 * Uploaded frames by theme in upload order, unsorted ones after, the built-in frames last —
 * unless the operator turned them off and there are uploaded frames to choose from instead.
 */
function themesFor(frames: CustomFrame[], builtin: boolean): Theme[] {
  const themes: Theme[] = [];
  const add = (name: string, choice: Choice) => {
    const theme = themes.find((t) => t.name === name);
    if (theme) theme.choices.push(choice);
    else themes.push({ name, choices: [choice] });
  };
  for (const frame of frames) add(frame.theme || UNSORTED_THEME, { id: frame.id, name: frame.name, frame, template: null });
  themes.sort((a, b) => Number(a.name === UNSORTED_THEME) - Number(b.name === UNSORTED_THEME));
  if (builtin || frames.length === 0) {
    for (const template of TEMPLATES) add(BUILTIN_THEME, { id: template.id, name: template.label, frame: null, template });
  }
  return themes;
}

/**
 * The frame shown first: an uploaded one already chosen, else the first of the first theme
 * (tonight's designs before the built-in ones). A session starts on Klasik by default, so
 * that alone does not count as a choice.
 */
function initialTemplate(session: Session, themes: Theme[]): string {
  const all = themes.flatMap((t) => t.choices);
  return all.some((c) => c.frame && c.id === session.template) ? session.template : all[0].id;
}

export default function FrameStage({
  session,
  payments,
  eventName,
  frames,
  seconds,
  livePreview,
  showDate,
  builtin,
  qr,
}: {
  session: Session;
  payments: boolean;
  eventName: string;
  frames: CustomFrame[];
  /** Time to choose a frame; the one on screen is kept when it runs out. */
  seconds: number;
  /** Show the guest live in the frame (else stand-in silhouettes). */
  livePreview: boolean;
  showDate: boolean;
  /** Offer the built-in frames too (they are offered anyway when nothing else is). */
  builtin: boolean;
  /** The code a built-in frame prints in its footer; null prints none. */
  qr: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const themes = useMemo(() => themesFor(frames, builtin), [frames, builtin]);
  const [template, setTemplate] = useState(() => initialTemplate(session, themes));
  const [themeName, setThemeName] = useState(() => themes.find((t) => t.choices.some((c) => c.id === template))?.name ?? themes[0].name);
  const theme = themes.find((t) => t.name === themeName) ?? themes[0];
  const frame = frames.find((f) => f.id === template) ?? null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const feedRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const camera = useCameraPreview(videoRef, feedRef, livePreview);
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const continueRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    setBoardFailed(false);
    liveBoard(
      { format: session.format, filterId: 'original', templateId: template, eventName, capturedAt: new Date(), frame, mirror: session.mirror, showDate, qr, lang },
      session.shots,
    )
      .then((next) => !cancelled && setBoard(next))
      .catch(() => !cancelled && setBoardFailed(true));
    return () => {
      cancelled = true;
    };
  }, [template, frame, eventName, session.format, session.shots, session.mirror, showDate, qr, lang]);

  // The guest sees themselves in every hole of the frame, as the camera will see them; stand-in
  // silhouettes until (or unless) a camera plays.
  useEffect(() => {
    const canvas = boardRef.current;
    const ctx = canvas?.getContext('2d');
    if (!board || !canvas || !ctx) return;
    canvas.width = Math.round(board.width * LIVE_SCALE);
    canvas.height = Math.round(board.height * LIVE_SCALE);
    const source = camera === 'device' ? videoRef.current : camera === 'tethered' ? feedRef.current : null;
    const paint = () => {
      ctx.setTransform(LIVE_SCALE, 0, 0, LIVE_SCALE, 0, 0);
      board.draw(ctx, source);
    };
    paint();
    if (!source) return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 1000 / LIVE_FPS) {
        last = now;
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [board, camera]);

  const pickTheme = (next: Theme) => {
    setThemeName(next.name);
    // Opening a theme shows it straight away, unless the chosen frame is already one of its own.
    if (!next.choices.some((c) => c.id === template)) setTemplate(next.choices[0].id);
  };

  const next = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template }),
      });
      if (!res.ok) throw new Error();
      router.push(session.requires_payment ? `/pay/${session.id}` : `/capture/${session.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  continueRef.current = () => void next();

  const left = useCountdown(seconds, !busy, () => continueRef.current());

  return (
    <main className="g-screen">
      <GuestHeader
        step="hias"
        payments={payments}
        left={
          <button
            className="g-ghost"
            onClick={() => {
              setBusy(true);
              // An empty session would only inflate the day's count; one with a QR stays (the server decides).
              void fetch(`/api/sessions/${session.id}`, { method: 'DELETE' })
                .catch(() => undefined)
                .finally(() => router.replace('/paket'));
            }}
            disabled={busy}
          >
            <ArrowLeft /> {t('Ganti paket')}
          </button>
        }
      />

      <div className="rv-layout">
        <div className="rv-board">
          <div className="fit">
            {boardFailed ? (
              <span className="g-lead">{t('Bingkai ini tidak bisa dimuat. Pilih bingkai lain, ya.')}</span>
            ) : (
              <canvas ref={boardRef} className="fr-board" aria-label={t('Pratinjau bingkai')} />
            )}
          </div>
          {camera && !boardFailed && <span className="fr-live">{t('● LIVE · ini kamu')}</span>}
          {/* Sources for the preview, playing but out of sight. */}
          <video ref={videoRef} className="fr-source" autoPlay playsInline muted />
          <canvas ref={feedRef} className="fr-source" />
        </div>

        <div className="rv-side">
          <div>
            <span className="g-kicker">
              {t(session.package_label)} · {t('{n} lembar', { n: session.prints })}
            </span>
            <h1 className="g-title" style={{ marginTop: 8 }}>
              {t('Pilih bingkai')}
            </h1>
          </div>

          {themes.length > 1 && (
            <section>
              <div className="rv-label">{t('Tema')}</div>
              <div className="fr-themes" role="tablist" aria-label={t('Tema bingkai')}>
                {themes.map((th) => (
                  <button key={th.name} className="fr-theme" role="tab" aria-selected={th.name === theme.name} onClick={() => pickTheme(th)}>
                    {t(th.name)}
                    <small>{th.choices.length}</small>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="rv-label">{themes.length > 1 || theme.name !== BUILTIN_THEME ? t('Bingkai {name}', { name: t(theme.name) }) : t('Bingkai')}</div>
            <div className="fr-grid">
              {theme.choices.map((choice) => (
                <button key={choice.id} className="rv-option" aria-pressed={template === choice.id} onClick={() => setTemplate(choice.id)}>
                  {choice.frame ? (
                    <span className="rv-thumb fr-thumb rv-thumb-frame">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={choice.frame.src} alt="" />
                    </span>
                  ) : (
                    <span className="rv-thumb fr-thumb">
                      <span
                        className="rv-swatch"
                        style={{ background: choice.template!.board, padding: `${10 * choice.template!.border + 6}% ${12 * choice.template!.border + 6}% 8%` }}
                      >
                        <b />
                        {choice.template!.eventMark && <u style={{ background: choice.template!.ink }} />}
                      </span>
                    </span>
                  )}
                  <span className="rv-name">{choice.template ? t(choice.name) : choice.name}</span>
                </button>
              ))}
            </div>
          </section>

          <p className="fr-note">{t('Gaya warna, beauty, dan stiker dipilih setelah foto.')}</p>

          {failed && <div className="g-error">{t('Pilihanmu belum tersimpan. Coba tekan Lanjut lagi, atau panggil petugas.')}</div>}
        </div>
      </div>

      <div className="g-bar">
        <div>
          <div className="g-bar-label">{t('Sisa waktu memilih')}</div>
          <div className="g-bar-value">{formatClock(left)}</div>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={next} disabled={busy}>
          {busy ? t('Menyimpan…') : payments ? t('Lanjut bayar') : t('Mulai foto')} <ArrowRight />
        </button>
      </div>
    </main>
  );
}
