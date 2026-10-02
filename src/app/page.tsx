'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/guest/GuestHeader';
import { useLongPress } from '@/components/guest/hooks';
import { ArrowRight } from '@/components/guest/icons';
import { PACKAGES, formatPrice } from '@/lib/packages';

const POLAROIDS = [
  { left: '6%', top: '14%', r: '-9deg', d: '11s', delay: '0s', c1: '#cc785c', c2: '#5b3f33' },
  { left: '15%', top: '58%', r: '7deg', d: '13s', delay: '-4s', c1: '#e0a878', c2: '#7a5a46' },
  { left: '31%', top: '76%', r: '-4deg', d: '10s', delay: '-2s', c1: '#8fae82', c2: '#3f4c3a' },
  { left: '73%', top: '9%', r: '8deg', d: '12s', delay: '-6s', c1: '#b9a0d0', c2: '#4f4560' },
  { left: '83%', top: '47%', r: '-7deg', d: '14s', delay: '-1s', c1: '#d9705f', c2: '#5e2d26' },
  { left: '64%', top: '72%', r: '5deg', d: '11s', delay: '-8s', c1: '#e8c48a', c2: '#7d6440' },
];

const STATUS_POLL_MS = 60_000;

/** The attract screen: what the booth shows between guests. One touch anywhere starts. */
export default function Standby() {
  const router = useRouter();
  const cheapest = Math.min(...PACKAGES.map((p) => p.priceIdr));
  const { holding, handlers } = useLongPress(3000, () => router.push('/operator'));

  useEffect(() => {
    router.prefetch('/paket');
    // The status call also runs the photo-retention sweep, so the idle booth keeps forgetting old sessions.
    const ping = () => void fetch('/api/status', { cache: 'no-store' }).catch(() => undefined);
    ping();
    const timer = setInterval(ping, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <main className="standby" onClick={() => router.push('/paket')}>
      <div
        {...handlers}
        onClick={(e) => e.stopPropagation()}
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
        <span className="g-kicker">Photobooth</span>
        <h1 className="standby-title">
          Senyum dulu,
          <br />
          <em>yuk!</em>
        </h1>
        <button className="g-cta standby-touch" type="button">
          Sentuh untuk mulai <ArrowRight />
        </button>
      </div>

      <div className="standby-foot">
        <span className="standby-chip">Mulai {formatPrice(cheapest)}</span>
        <span className="standby-chip">Bayar pakai QRIS</span>
        <span className="standby-chip">Langsung dicetak</span>
        <span className="standby-chip">Simpan ke HP</span>
      </div>
    </main>
  );
}
