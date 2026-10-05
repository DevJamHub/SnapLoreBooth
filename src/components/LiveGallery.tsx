'use client';

import { useEffect, useRef, useState } from 'react';
import LoopVideo from '@/components/LoopVideo';
import type { GalleryItem } from '@/lib/gallery';

const POLL_MS = 5000;
/** How long each group of guests stays on screen; their 3-second clips loop about three times. */
const PAGE_MS = 9000;
const FADE_MS = 800;

const signature = (items: GalleryItem[]) => items.map((i) => `${i.id}:${i.live ?? ''}`).join('|');

/**
 * One link, two faces. While the event runs it is the venue's second screen: three guests'
 * live sheets at a time, fading to the next three, round and round. When the operator ends
 * the event the same page becomes the photo gallery everyone can download from.
 */
export default function LiveGallery({
  slug,
  eventName,
  initial,
  initialEnded,
  qrDataUrl,
}: {
  slug: string;
  eventName: string;
  initial: GalleryItem[];
  initialEnded: boolean;
  qrDataUrl: string;
}) {
  const [items, setItems] = useState(initial);
  const [ended, setEnded] = useState(initialEnded);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef(new Set(initial.map((i) => i.id)));

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/events/${slug}/gallery`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { ended: boolean; items: GalleryItem[] };
        const arrived = data.items.filter((i) => !known.current.has(i.id)).map((i) => i.id);
        data.items.forEach((i) => known.current.add(i.id));
        // Most polls bring nothing new; keeping the same list spares the screen a re-render.
        setItems((prev) => (signature(prev) === signature(data.items) ? prev : data.items));
        setEnded(data.ended);
        if (arrived.length > 0) setFresh((prev) => new Set([...prev, ...arrived]));
      } catch {
        // The venue Wi-Fi blinked; the screen keeps what it has and tries again.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [slug]);

  return ended ? (
    <PhotoGallery slug={slug} eventName={eventName} items={items} fresh={fresh} />
  ) : (
    <Stage eventName={eventName} items={items} fresh={fresh} qrDataUrl={qrDataUrl} />
  );
}

/** Three guests at a time on the venue screen (one on a phone), fading through everyone. */
function Stage({ eventName, items, fresh, qrDataUrl }: { eventName: string; items: GalleryItem[]; fresh: Set<string>; qrDataUrl: string }) {
  const [perPage, setPerPage] = useState(3);
  // The rotation runs oldest first, so everyone gets their turn in the order they came.
  const [order, setOrder] = useState<string[]>(() => [...items].reverse().map((i) => i.id));
  const [start, setStart] = useState(0);
  const [visible, setVisible] = useState(true);
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    const update = () => setPerPage(window.innerWidth < 760 ? 1 : 3);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // A guest who just finished goes straight to the next group, so they see themselves while still here.
  useEffect(() => {
    setOrder((prev) => {
      const present = new Set(items.map((i) => i.id));
      const kept = prev.filter((id) => present.has(id));
      const added = [...items].reverse().map((i) => i.id).filter((id) => !prev.includes(id));
      if (added.length === 0 && kept.length === prev.length) return prev;
      const insertAt = Math.min(startRef.current + perPage, kept.length);
      return [...kept.slice(0, insertAt), ...added, ...kept.slice(insertAt)];
    });
  }, [items, perPage]);

  const rotates = order.length > perPage;

  useEffect(() => {
    if (!rotates) {
      setStart(0);
      setVisible(true);
      return;
    }
    let swap: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => {
      setVisible(false);
      swap = setTimeout(() => {
        setStart((s) => (s + perPage) % order.length);
        setVisible(true);
      }, FADE_MS);
    }, PAGE_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(swap);
    };
  }, [rotates, perPage, order.length]);

  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = (rotates
    ? Array.from({ length: perPage }, (_, k) => order[(start + k) % order.length])
    : order
  )
    .map((id) => byId.get(id))
    .filter((i): i is GalleryItem => !!i);

  return (
    <main className="stage">
      <header className="stage-head">
        <span className="g-logo">
          Snaplore<span>Booth</span>
        </span>
        <h1 className="stage-title">{eventName}</h1>
        <div className="stage-side">
          <span className="stage-count">{items.length} tamu sudah foto</span>
          <span className="stage-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR galeri acara" />
            <span>Scan sekarang, galeri lengkap dibuka setelah acara selesai</span>
          </span>
        </div>
      </header>

      <div className="stage-row" data-visible={visible} style={{ ['--per-page' as string]: perPage }}>
        {shown.length === 0 ? (
          <p className="g-lead" style={{ fontSize: 26, textAlign: 'center', alignSelf: 'center' }}>
            Foto pertama akan muncul di sini ✨
          </p>
        ) : (
          shown.map((item) => (
            <div key={`${start}-${item.id}`} className="stage-card">
              <div className="fit cq">
                <div className="stage-sheet">
                  {item.live ? (
                    <LoopVideo src={item.live} poster={item.src} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.src} alt="Foto tamu" />
                  )}
                  {fresh.has(item.id) && <span className="stage-new">Baru</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

    </main>
  );
}

/** After the event: every sheet, newest first, each one downloadable. */
function PhotoGallery({ slug, eventName, items, fresh }: { slug: string; eventName: string; items: GalleryItem[]; fresh: Set<string> }) {
  const [open, setOpen] = useState<GalleryItem | null>(null);

  return (
    <main className="gal">
      <header className="gal-head">
        <span className="g-logo">
          Snaplore<span>Booth</span>
        </span>
        <span className="g-kicker">Galeri acara</span>
        <h1 className="g-title">{eventName}</h1>
        <p className="g-lead" style={{ fontSize: 17 }}>
          {items.length === 0 ? 'Belum ada foto di acara ini.' : `${items.length} foto · ketuk untuk melihat & download`}
        </p>
      </header>

      <div className="gal-grid">
        {items.map((item) => (
          <button key={item.id} className={`gal-item${fresh.has(item.id) ? ' gal-fresh' : ''}`} onClick={() => setOpen(item)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.src} alt="Foto dari booth" loading="lazy" />
          </button>
        ))}
      </div>

      {open && (
        <div className="g-modal-backdrop" onClick={() => setOpen(null)}>
          <div className="gal-open" onClick={(e) => e.stopPropagation()}>
            {open.live ? (
              <LoopVideo src={open.live} poster={open.src} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.src} alt="Foto dari booth" />
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a className="g-cta" href={open.src} download={`${slug}-${open.id}.jpeg`} style={{ minHeight: 56, fontSize: 18 }}>
                Download foto
              </a>
              {open.live && (
                <a className="g-ghost" href={open.live} download={`${slug}-${open.id}-live.${open.live.split('.').pop()}`}>
                  Download video
                </a>
              )}
              <button className="g-ghost" onClick={() => setOpen(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
