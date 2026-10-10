'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/guest/lang';

const STORY = { width: 1080, height: 1920 };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed'));
    img.src = src;
  });
}

/** The sheet on a 9:16 card for an Instagram or WhatsApp story: a blurred copy behind it, the event under it. */
async function storyCard(sheet: HTMLImageElement, eventName: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = STORY.width;
  canvas.height = STORY.height;
  const ctx = canvas.getContext('2d')!;

  const cover = Math.max(STORY.width / sheet.width, STORY.height / sheet.height) * 1.15;
  ctx.fillStyle = '#181816';
  ctx.fillRect(0, 0, STORY.width, STORY.height);
  ctx.save();
  ctx.filter = 'blur(48px) brightness(0.55) saturate(1.2)';
  ctx.drawImage(sheet, (STORY.width - sheet.width * cover) / 2, (STORY.height - sheet.height * cover) / 2, sheet.width * cover, sheet.height * cover);
  ctx.restore();
  // Browsers without canvas filters (Safari before 18) get a dark wash instead of the blur.
  if (ctx.filter !== 'blur(48px) brightness(0.55) saturate(1.2)') {
    ctx.fillStyle = 'rgba(24, 24, 22, 0.72)';
    ctx.fillRect(0, 0, STORY.width, STORY.height);
  }

  const room = { width: STORY.width - 180, height: STORY.height - 520 };
  const fit = Math.min(room.width / sheet.width, room.height / sheet.height);
  const w = Math.round(sheet.width * fit);
  const h = Math.round(sheet.height * fit);
  const x = Math.round((STORY.width - w) / 2);
  const y = Math.round(200 + (room.height - h) / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.drawImage(sheet, x, y, w, h);
  ctx.restore();

  const display = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'Georgia';
  const body = getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim() || 'system-ui';
  await Promise.all([document.fonts?.load(`500 64px ${display}`), document.fonts?.load(`600 30px ${body}`)]).catch(() => undefined);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f3eee8';
  ctx.font = `500 64px ${display}, Georgia, serif`;
  ctx.fillText(eventName.slice(0, 32), STORY.width / 2, STORY.height - 190, STORY.width - 160);
  // The brand under the event's name; not twice when the event is the booth's own.
  if (!/^snaplore\s*booth$/i.test(eventName.trim())) {
    ctx.fillStyle = '#cc785c';
    ctx.font = `600 30px ${body}, system-ui, sans-serif`;
    ctx.fillText('SNAPLOREBOOTH', STORY.width / 2, STORY.height - 130);
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('story failed'))), 'image/jpeg', 0.92));
}

/** Shares files through the phone's own sheet when it can; false when the phone cannot. */
async function shareFiles(files: File[], text: string): Promise<boolean> {
  if (!navigator.canShare?.({ files })) return false;
  try {
    await navigator.share({ files, text });
  } catch {
    // Closed without sharing; nothing to do.
  }
  return true;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * On the page the QR opens: send the sheet on (the phone's share sheet, WhatsApp) and make a
 * story-sized copy. The sheet is fetched ahead, because a share must start within the tap.
 */
export default function ShareTools({
  sessionId,
  sheetSrc,
  eventName,
  text,
  link,
}: {
  sessionId: string;
  sheetSrc: string;
  eventName: string;
  /** Goes with whatever is shared. */
  text: string;
  /** This page's public address, for a share that sends a link. */
  link: string;
}) {
  const t = useT();
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [story, setStory] = useState<{ blob: Blob; url: string } | null>(null);
  const [making, setMaking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sheetImage = useRef<Promise<HTMLImageElement> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(sheetSrc)
      .then((res) => res.blob())
      .then((blob) => !cancelled && setSheetFile(new File([blob], `snaplorebooth-${sessionId}.jpg`, { type: blob.type || 'image/jpeg' })))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId, sheetSrc]);

  useEffect(() => {
    if (!story) return;
    return () => URL.revokeObjectURL(story.url);
  }, [story]);

  const share = async () => {
    setNote(null);
    if (sheetFile && (await shareFiles([sheetFile], `${text} ${link}`))) return;
    if (navigator.share) {
      await navigator.share({ url: link, text }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setNote(t('Link disalin. Tempel di chat mana saja.'));
    } catch {
      setNote(t('Salin link dari kolom alamat browser.'));
    }
  };

  const makeStory = async () => {
    setMaking(true);
    setNote(null);
    try {
      sheetImage.current ??= loadImage(sheetSrc);
      const blob = await storyCard(await sheetImage.current, eventName);
      setStory({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setNote(t('Versi story belum bisa dibuat di HP ini. Download fotonya saja, ya.'));
    } finally {
      setMaking(false);
    }
  };

  const storyName = `snaplorebooth-${sessionId}-story.jpg`;

  return (
    <div className="dl-share">
      <div className="dl-share-row">
        <button className="g-ghost" onClick={share}>
          {t('Bagikan')}
        </button>
        <a className="g-ghost" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <button className="g-ghost" onClick={makeStory} disabled={making}>
          {t(making ? 'Membuat…' : 'Versi Story')}
        </button>
      </div>
      {note && <p className="dl-note">{note}</p>}

      {story && (
        <div className="dl-story" role="dialog" aria-label={t('Versi story')} onClick={() => setStory(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={story.url} alt={t('Fotomu dalam ukuran story')} />
            <div className="dl-share-row">
              <button
                className="g-cta"
                onClick={async () => {
                  const file = new File([story.blob], storyName, { type: 'image/jpeg' });
                  if (!(await shareFiles([file], text))) download(story.blob, storyName);
                }}
              >
                {t('Bagikan ke Story')}
              </button>
              <button className="g-ghost" onClick={() => download(story.blob, storyName)}>
                {t('Download')}
              </button>
              <button className="g-ghost" onClick={() => setStory(null)}>
                {t('Tutup')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Motion = { state: 'idle' | 'making' | 'failed' } | { state: 'ready'; url: string };

/** Asks the booth for a GIF or a boomerang; it is made on the first ask and kept for the next. */
export function useMotion(sessionId: string, body: { kind: 'gif' } | { kind: 'boomerang'; index: number }) {
  const [motion, setMotion] = useState<Motion>({ state: 'idle' });
  const make = async () => {
    setMotion({ state: 'making' });
    try {
      const res = await fetch(`/api/sessions/${sessionId}/motion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { url?: string };
      if (!res.ok || !data.url) throw new Error();
      setMotion({ state: 'ready', url: data.url });
    } catch {
      setMotion({ state: 'failed' });
    }
  };
  return { motion, make };
}
