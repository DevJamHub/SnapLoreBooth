'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import DecorEditor, { inkPointCount } from '@/components/DecorEditor';
import GuestHeader from '@/components/guest/GuestHeader';
import { useLang, useT } from '@/components/guest/lang';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { ArrowRight } from '@/components/guest/icons';
import {
  DECOR_COLORS,
  DECOR_FONTS,
  DECOR_LIMITS,
  INK_WIDTHS,
  STICKERS,
  decorTile,
  loadDecorFonts,
  type DecorFont,
  type DecorItem,
  type TextDecor,
} from '@/lib/decor';
import { BACKGROUNDS, NO_BACKGROUND } from '@/lib/backgrounds';
import { BEAUTY, FILTERS, filterCss, filterFx } from '@/lib/packages';
import { boardLayout, composeStrip, type StripOptions } from '@/lib/strip';
import type { CustomFrame, Session } from '@/lib/types';

const SAMPLE_SIZE = 240;
/** Undo goes back this many changes. */
const HISTORY_KEPT = 40;

type Tab = 'warna' | 'latar' | 'stiker' | 'tulisan' | 'gambar';

const DECOR_TABS: { id: Tab; label: string }[] = [
  { id: 'stiker', label: 'Stiker' },
  { id: 'tulisan', label: 'Tulisan' },
  { id: 'gambar', label: 'Gambar' },
];

const INK_LABELS = ['Tipis', 'Sedang', 'Tebal'];

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
  qr,
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
    /** Stickers, writing and drawing on the sheet. */
    decor: boolean;
    /** AI backdrops behind the guests. */
    backgrounds: boolean;
  };
  showDate: boolean;
  /** The code a built-in frame prints in its footer; null prints none. */
  qr: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const looks = FILTERS.filter((f) => settings.filters.includes(f.id));
  const hasColour = looks.length > 1 || settings.beauty;
  // With one look, no beauty, no backdrops and no stickers there is nothing to choose: the sheet is made and printed.
  const nothingToChoose = !hasColour && !settings.decor && !settings.backgrounds;
  const tabs: { id: Tab; label: string }[] = [
    ...(hasColour ? [{ id: 'warna' as Tab, label: 'Warna' }] : []),
    ...(settings.backgrounds ? [{ id: 'latar' as Tab, label: 'Latar AI' }] : []),
    ...(settings.decor ? DECOR_TABS : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'warna');

  const [filter, setFilter] = useState(looks.some((f) => f.id === session.filter) ? session.filter : 'original');
  const [beauty, setBeauty] = useState(settings.beauty && BEAUTY.some((b) => b.id === session.beauty) ? session.beauty : 'off');
  const [background, setBackground] = useState(settings.backgrounds && BACKGROUNDS.some((b) => b.id === session.background) ? session.background : NO_BACKGROUND);
  const [bgFailed, setBgFailed] = useState(false);
  const [bgThumbs, setBgThumbs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [composing, setComposing] = useState(true);
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const continueRef = useRef<() => void>(() => {});
  const composed = useRef(0);

  // Stickers, writing and doodles, with an undo history of whole gestures.
  const [items, setItems] = useState<DecorItem[]>(settings.decor ? session.decor : []);
  const [selected, setSelected] = useState<number | null>(null);
  const history = useRef<DecorItem[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [full, setFull] = useState(false);
  const [ink, setInk] = useState({ color: DECOR_COLORS[3], width: INK_WIDTHS[1] });
  const [text, setText] = useState('');
  const [font, setFont] = useState<DecorFont>('hand');
  const [textColor, setTextColor] = useState(DECOR_COLORS[0]);
  const [stickerThumbs, setStickerThumbs] = useState<Record<string, string>>({});

  const layout = useMemo(() => boardLayout(session.format, session.template, session.shots, frame), [session.format, session.template, session.shots, frame]);
  const chosen = selected !== null ? items[selected] : null;
  const chosenText = chosen?.kind === 'text' ? chosen : null;

  const optionsFor = (filterId: string, beautyId: string, backgroundId: string = NO_BACKGROUND): StripOptions => ({
    format: session.format,
    filterId,
    templateId: session.template,
    eventName,
    capturedAt: new Date(session.created_at),
    frame,
    mirror: session.mirror,
    beauty: beautyId,
    showDate,
    qr,
    background: backgroundId,
    lang,
  });
  const optionsRef = useRef(optionsFor);
  optionsRef.current = optionsFor;

  useEffect(() => {
    sampleOf(photos[0], session.mirror).then(setSample, () => undefined);
    // Held down on the preview, the sheet shows the photos as they were shot.
    composeStrip(photos, optionsRef.current('original', 'off'), 0.8).then(setOriginal, () => undefined);
  }, [photos, session.mirror]);

  // The preview is the print itself, recomposed for every choice. Only the newest one shows.
  // Stickers are laid over it on screen, so moving one never waits for a recompose.
  useEffect(() => {
    const mine = ++composed.current;
    setComposing(true);
    composeStrip(photos, optionsRef.current(filter, beauty, background), 0.8)
      .then((url) => mine === composed.current && setPreview(url))
      .catch(() => {
        // A device whose browser cannot run the AI keeps the photos' own background.
        if (mine === composed.current && background !== NO_BACKGROUND) {
          setBgFailed(true);
          setBackground(NO_BACKGROUND);
        }
      })
      .finally(() => mine === composed.current && setComposing(false));
  }, [filter, beauty, background, photos]);

  // The AI takes a few seconds to load the first time; it loads quietly while the guest looks
  // around, so choosing a backdrop is quick.
  useEffect(() => {
    if (!settings.backgrounds) return;
    const timer = setTimeout(() => void import('@/lib/segment').then((m) => m.loadSegmenter()).catch(() => undefined), 1500);
    return () => clearTimeout(timer);
  }, [settings.backgrounds]);

  // Backdrop swatches, drawn once.
  useEffect(() => {
    if (!settings.backgrounds) return;
    const thumbs: Record<string, string> = {};
    for (const b of BACKGROUNDS) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 160;
      b.draw(canvas.getContext('2d')!, 160, 160);
      thumbs[b.id] = canvas.toDataURL('image/jpeg', 0.85);
    }
    setBgThumbs(thumbs);
  }, [settings.backgrounds]);

  // Sticker buttons show the very pictures that print, once the fonts the badges use are in.
  useEffect(() => {
    if (!settings.decor) return;
    let cancelled = false;
    const sample = STICKERS.map((s) => ({ kind: 'sticker' as const, sticker: s.id, x: 0, y: 0, size: 1, angle: 0 }));
    void loadDecorFonts([...sample, ...DECOR_FONTS.map((f) => ({ kind: 'text' as const, text: 'Aa', font: f.id, color: '#ffffff', x: 0, y: 0, size: 1, angle: 0 }))]).then(() => {
      if (cancelled) return;
      const thumbs: Record<string, string> = {};
      for (const item of sample) {
        const tile = decorTile(item, eventName);
        if (tile) thumbs[item.sticker] = tile.toDataURL('image/png');
      }
      setStickerThumbs(thumbs);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.decor, eventName]);

  /** One undo step: called as a gesture or a tap begins, before it changes anything. */
  const checkpoint = () => {
    history.current = [...history.current.slice(-(HISTORY_KEPT - 1)), items];
    setCanUndo(true);
    setFull(false);
  };

  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    setItems(previous);
    setSelected(null);
    setCanUndo(history.current.length > 0);
    setFull(false);
  };

  const clearAll = () => {
    if (items.length === 0) return;
    checkpoint();
    setItems([]);
    setSelected(null);
  };

  const roomForOne = () => {
    if (items.length >= DECOR_LIMITS.items) {
      setFull(true);
      return false;
    }
    return true;
  };

  /** New pieces land near the middle, a little askew, so a second tap does not hide the first. */
  const placement = (size: number) => ({
    x: Math.round(layout.width * (0.5 + (Math.random() - 0.5) * 0.3)),
    y: Math.round(layout.height * (0.45 + (Math.random() - 0.5) * 0.3)),
    size: Math.round(size),
    angle: Math.round((Math.random() - 0.5) * 24),
  });

  const addSticker = (id: string) => {
    if (!roomForOne()) return;
    checkpoint();
    const isBadge = STICKERS.find((s) => s.id === id && 'badge' in s);
    const next = [...items, { kind: 'sticker' as const, sticker: id, ...placement(layout.width * (isBadge ? 0.12 : 0.24)) }];
    setItems(next);
    setSelected(next.length - 1);
  };

  const addText = () => {
    const words = text.replace(/\s+/g, ' ').trim().slice(0, DECOR_LIMITS.text);
    if (!words || !roomForOne()) return;
    checkpoint();
    const next = [...items, { kind: 'text' as const, text: words, font, color: textColor, ...placement(layout.width * 0.1) }];
    setItems(next);
    setSelected(next.length - 1);
    setText('');
  };

  /** Font and colour apply to the selected writing too, so a guest can restyle what they wrote. */
  const restyle = (patch: Partial<Pick<TextDecor, 'font' | 'color' | 'text'>>) => {
    if (selected === null || !chosenText) return;
    setItems((list) => list.map((item, i) => (i === selected && item.kind === 'text' ? { ...item, ...patch } : item)));
  };

  const next = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setSelected(null);
    try {
      // Writing left empty while being edited is dropped rather than refused.
      const decor = items.filter((item) => item.kind !== 'text' || item.text.trim());
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, beauty, ...(settings.backgrounds ? { background } : {}), ...(settings.decor ? { decor } : {}) }),
      });
      if (!res.ok) throw new Error();
      const dataUrl = await composeStrip(photos, { ...optionsRef.current(filter, beauty, background), decor: settings.decor ? decor : [] });
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
  const onColour = tab === 'warna' || tab === 'latar';
  const shown = comparing && original ? original : preview;
  const stopComparing = () => setComparing(false);
  const compareHandlers = onColour
    ? {
        onPointerDown: () => setComparing(true),
        onPointerUp: stopComparing,
        onPointerLeave: stopComparing,
        onPointerCancel: stopComparing,
      }
    : {};

  const hint = t(
    comparing
      ? 'Foto asli'
      : onColour
        ? composing
          ? background !== NO_BACKGROUND && tab === 'latar'
            ? 'AI memisahkan latar…'
            : 'Menerapkan…'
          : 'Tahan untuk lihat aslinya'
        : tab === 'gambar'
          ? 'Gambar pakai jari'
          : items.length
            ? 'Geser, putar, atau perbesar'
            : 'Pilih hiasan di samping',
  );

  return (
    <main className="g-screen">
      <GuestHeader step="gaya" payments={payments} />

      <div className="rv-layout">
        <div className="rv-board st-board" data-tab={tab} {...compareHandlers}>
          <div className="fit dc-fit">
            {shown ? (
              <div className="dc-sheet" style={{ '--ratio': layout.width / layout.height } as React.CSSProperties}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shown} alt={t(comparing ? 'Foto asli' : 'Pratinjau hasil cetak')} draggable={false} />
                {settings.decor && !comparing && (
                  <DecorEditor
                    width={layout.width}
                    height={layout.height}
                    items={items}
                    eventName={eventName}
                    interactive={!onColour && !busy}
                    pen={tab === 'gambar' ? ink : null}
                    selected={selected}
                    onSelect={setSelected}
                    onChange={setItems}
                    onGestureStart={checkpoint}
                    onFull={() => setFull(true)}
                  />
                )}
              </div>
            ) : (
              <span className="g-lead">{t('Menyusun fotomu…')}</span>
            )}
          </div>
          {shown && (
            <span className="st-hint" data-on={comparing}>
              {hint}
            </span>
          )}
        </div>

        <div className="rv-side">
          <div>
            <span className="g-kicker">{t('Foto selesai · {n} pose', { n: session.shots })}</span>
            <h1 className="g-title" style={{ marginTop: 8 }}>
              {t(nothingToChoose ? 'Menyusun fotomu…' : settings.decor ? 'Hias fotomu' : 'Pilih gaya')}
            </h1>
          </div>

          {tabs.length > 1 && (
            <div className="fr-themes" role="tablist" aria-label={t('Hias hasil')}>
              {tabs.map((tb) => (
                <button
                  key={tb.id}
                  className="fr-theme"
                  role="tab"
                  aria-selected={tab === tb.id}
                  onClick={() => {
                    setTab(tb.id);
                    setComparing(false);
                    if (tb.id !== 'tulisan' || !chosenText) setSelected(null);
                  }}
                >
                  {t(tb.label)}
                </button>
              ))}
            </div>
          )}

          {tab === 'latar' && (
            <section>
              <div className="rv-label">{t('Ganti latar belakang')}</div>
              <div className="rv-options">
                <button className="rv-option" aria-pressed={background === NO_BACKGROUND} onClick={() => setBackground(NO_BACKGROUND)} disabled={busy}>
                  <span className="rv-thumb">
                    {sample && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sample} alt="" />
                    )}
                  </span>
                  {t('Asli')}
                </button>
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    className="rv-option"
                    aria-pressed={background === b.id}
                    onClick={() => {
                      setBgFailed(false);
                      setBackground(b.id);
                    }}
                    disabled={busy || composing}
                  >
                    <span className="rv-thumb">
                      {bgThumbs[b.id] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={bgThumbs[b.id]} alt="" />
                      )}
                    </span>
                    {t(b.label)}
                  </button>
                ))}
              </div>
              <p className="fr-note" style={{ marginTop: 12 }}>
                {t(
                  bgFailed
                    ? 'Latar AI belum bisa jalan di perangkat ini. Fotomu tetap dengan latar aslinya.'
                    : 'AI di booth memisahkan kamu dari latar. Hanya untuk foto cetak; video tetap latar asli.',
                )}
              </p>
            </section>
          )}

          {tab === 'warna' && (
            <>
              <section hidden={looks.length <= 1}>
                <div className="rv-label">{t('Gaya warna')}</div>
                <div className="rv-options">
                  {looks.map((f) => (
                    <button key={f.id} className="rv-option" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} disabled={busy}>
                      <span className="rv-thumb">
                        {sample && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={sample} alt="" style={{ filter: filterCss(f.id) }} />
                        )}
                        {filterFx(f.id).map((fx) => (
                          <i key={fx} className={`rv-fx rv-fx-${fx}`} aria-hidden="true" />
                        ))}
                      </span>
                      {t(f.label)}
                    </button>
                  ))}
                </div>
              </section>

              <section hidden={!settings.beauty}>
                <div className="rv-label">{t('Mode beauty')}</div>
                <div className="st-beauty" role="radiogroup" aria-label={t('Mode beauty')}>
                  {BEAUTY.map((b) => (
                    <button key={b.id} role="radio" aria-checked={beauty === b.id} onClick={() => setBeauty(b.id)} disabled={busy}>
                      <b>{t(b.label)}</b>
                      <small>{t(b.blurb)}</small>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {tab === 'stiker' && (
            <section>
              <div className="rv-label">{t('Ketuk untuk menempel')}</div>
              <div className="dc-stickers">
                {STICKERS.map((s) => (
                  <button key={s.id} className="dc-sticker" onClick={() => addSticker(s.id)} disabled={busy} aria-label={t(s.label)} data-badge={'badge' in s}>
                    {stickerThumbs[s.id] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={stickerThumbs[s.id]} alt="" draggable={false} />
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {tab === 'tulisan' && (
            <section className="dc-text">
              <div className="rv-label">{t(chosenText ? 'Ubah tulisan' : 'Tulis sesuatu')}</div>
              <div className="dc-text-row">
                <input
                  className="dc-input"
                  value={chosenText ? chosenText.text : text}
                  maxLength={DECOR_LIMITS.text}
                  placeholder={t('mis. Bestie forever')}
                  enterKeyHint="done"
                  onFocus={() => chosenText && checkpoint()}
                  onChange={(e) => (chosenText ? restyle({ text: e.target.value }) : setText(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    if (chosenText) setSelected(null);
                    else addText();
                    (e.target as HTMLInputElement).blur();
                  }}
                  disabled={busy}
                />
                {chosenText ? (
                  <button className="g-ghost" onClick={() => setSelected(null)}>
                    {t('Selesai')}
                  </button>
                ) : (
                  <button className="g-cta dc-add" onClick={addText} disabled={busy || !text.trim()}>
                    {t('Tempel')}
                  </button>
                )}
              </div>
              <div className="dc-fonts" role="radiogroup" aria-label={t('Jenis huruf')}>
                {DECOR_FONTS.map((f) => (
                  <button
                    key={f.id}
                    role="radio"
                    aria-checked={(chosenText?.font ?? font) === f.id}
                    style={{ fontFamily: `var(${f.css})`, fontWeight: f.weight }}
                    onClick={() => {
                      if (chosenText) checkpoint();
                      setFont(f.id);
                      restyle({ font: f.id });
                    }}
                  >
                    {t(f.label)}
                  </button>
                ))}
              </div>
              <Swatches
                value={chosenText?.color ?? textColor}
                onPick={(color) => {
                  if (chosenText) checkpoint();
                  setTextColor(color);
                  restyle({ color });
                }}
              />
            </section>
          )}

          {tab === 'gambar' && (
            <section className="dc-text">
              <div className="rv-label">{t('Warna pena')}</div>
              <Swatches value={ink.color} onPick={(color) => setInk((p) => ({ ...p, color }))} />
              <div className="rv-label" style={{ marginTop: 6 }}>
                {t('Tebal garis')}
              </div>
              <div className="dc-fonts" role="radiogroup" aria-label={t('Tebal garis')}>
                {INK_WIDTHS.map((w, i) => (
                  <button key={w} role="radio" aria-checked={ink.width === w} onClick={() => setInk((p) => ({ ...p, width: w }))}>
                    <span className="dc-nib" style={{ width: Math.max(w / 2, 4), height: Math.max(w / 2, 4), background: ink.color }} />
                    {t(INK_LABELS[i])}
                  </button>
                ))}
              </div>
            </section>
          )}

          {!onColour && (
            <div className="dc-tools">
              <button className="g-ghost" onClick={undo} disabled={!canUndo || busy}>
                {t('Urungkan')}
              </button>
              <button className="g-ghost" onClick={clearAll} disabled={items.length === 0 || busy}>
                {t('Hapus semua hiasan')}
              </button>
              <span className="dc-count">
                {t('{n}/{max} hiasan', { n: items.length, max: DECOR_LIMITS.items })}
                {inkPointCount(items) > DECOR_LIMITS.inkPoints * 0.8 ? ` · ${t('coretan hampir penuh')}` : ''}
              </span>
            </div>
          )}
          {full && <div className="g-error">{t('Hiasannya sudah penuh. Hapus beberapa dulu, atau lanjut cetak.')}</div>}

          {failed && <div className="g-error">{t('Fotomu belum tersimpan. Coba tekan Cetak lagi, atau panggil petugas.')}</div>}
        </div>
      </div>

      <div className="g-bar">
        <div>
          <div className="g-bar-label">{t('Sisa waktu menghias')}</div>
          <div className="g-bar-value">{formatClock(left)}</div>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={next} disabled={busy || !preview}>
          {busy ? t('Menyimpan…') : t('Cetak sekarang')} <ArrowRight />
        </button>
      </div>
    </main>
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const t = useT();
  return (
    <div className="dc-swatches" role="radiogroup" aria-label={t('Warna')}>
      {DECOR_COLORS.map((color) => (
        <button key={color} role="radio" aria-checked={value === color} aria-label={color} style={{ background: color }} onClick={() => onPick(color)} />
      ))}
    </div>
  );
}
