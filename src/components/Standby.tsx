'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/guest/GuestHeader';
import { useLongPress } from '@/components/guest/hooks';
import { ArrowRight } from '@/components/guest/icons';
import type { BoothConfig } from '@/lib/config';
import { formatPrice } from '@/lib/packages';

// Placed to keep the headline, the button and the bottom chips clear at iPad landscape sizes.
const POLAROIDS = [
  { left: '5%', top: '12%', r: '-9deg', d: '11s', delay: '0s', c1: '#cc785c', c2: '#5b3f33' },
  { left: '13%', top: '52%', r: '7deg', d: '13s', delay: '-4s', c1: '#e0a878', c2: '#7a5a46' },
  { left: '73%', top: '7%', r: '8deg', d: '12s', delay: '-6s', c1: '#b9a0d0', c2: '#4f4560' },
  { left: '84%', top: '42%', r: '-7deg', d: '14s', delay: '-1s', c1: '#d9705f', c2: '#5e2d26' },
  { left: '67%', top: '56%', r: '5deg', d: '11s', delay: '-8s', c1: '#8fae82', c2: '#3f4c3a' },
];

const STATUS_POLL_MS = 60_000;

/** The attract screen: what the booth shows between guests. Only the start button starts. */
export default function Standby({
  fromPrice,
  eventName,
  text,
}: {
  fromPrice: number | null;
  eventName: string | null;
  /** The operator's words for this screen (Konsol → Pengaturan → Layar awal). */
  text: BoothConfig['standby'];
}) {
  const router = useRouter();
  const { holding, handlers } = useLongPress(text.holdSeconds * 1000, () => router.push('/operator'));

  useEffect(() => {
    router.prefetch('/paket');
    // The status call also runs the photo-retention sweep, so the idle booth keeps forgetting old sessions.
    const ping = () => void fetch('/api/status', { cache: 'no-store' }).catch(() => undefined);
    ping();
    const timer = setInterval(ping, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <main className="standby">
      <div
        {...handlers}
        onContextMenu={(e) => e.preventDefault()}
        className="standby-logo"
      >
        <Logo />
      </div>
      <span className="standby-hold" data-show={holding}>
        Tahan untuk menu operator…
      </span>

      {POLAROIDS.map((p, i) => (
        <div
          key={i}
          className="polaroid"
          aria-hidden="true"
          style={
            {
              left: p.left,
              top: p.top,
              '--r': p.r,
              '--d': p.d,
              '--delay': p.delay,
              '--c1': p.c1,
              '--c2': p.c2,
            } as React.CSSProperties
          }
        >
          <div className="polaroid-photo" />
        </div>
      ))}

      <div className="standby-center">
        <span className="g-kicker">{text.kicker || eventName || 'Photobooth'}</span>
        <h1 className="standby-title">
          {text.title}
          {text.accent && (
            <>
              <br />
              <em>{text.accent}</em>
            </>
          )}
        </h1>
        <button className="g-cta standby-touch" type="button" onClick={() => router.push('/paket')}>
          {text.button} <ArrowRight />
        </button>
      </div>

      <div className="standby-foot" hidden={!text.chips}>
        {fromPrice === null ? (
          <span className="standby-chip">Gratis untuk tamu</span>
        ) : (
          <>
            <span className="standby-chip">Mulai {formatPrice(fromPrice)}</span>
            <span className="standby-chip">Bayar pakai QRIS</span>
          </>
        )}
        <span className="standby-chip">Langsung dicetak</span>
        <span className="standby-chip">Simpan ke HP</span>
      </div>
    </main>
  );
}
