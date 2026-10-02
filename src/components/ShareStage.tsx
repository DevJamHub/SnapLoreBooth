'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { Check, Phone, Printer } from '@/components/guest/icons';
import type { Session } from '@/lib/types';

/** Seconds one copy takes on a dye-sub printer. Printing is simulated until a printer is wired. */
const SECONDS_PER_COPY = 4;
const FINISH_AFTER_SECONDS = 45;

export default function ShareStage({
  session,
  stripUrl,
  qrDataUrl,
  retentionHours,
  payments,
}: {
  session: Session;
  stripUrl: string;
  qrDataUrl: string;
  retentionHours: number;
  payments: boolean;
}) {
  const router = useRouter();
  const [printed, setPrinted] = useState(0);
  const done = printed >= session.prints;

  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => setPrinted((n) => n + 1), SECONDS_PER_COPY * 1000);
    return () => clearTimeout(timer);
  }, [done, printed]);

  useEffect(() => {
    if (!done) return;
    void fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
  }, [done, session.id]);

  const finish = () => router.replace('/');
  const left = useCountdown(FINISH_AFTER_SECONDS, done, finish);

  return (
    <main className="g-screen">
      <GuestHeader step="cetak" payments={payments} />

      <div className="sh-layout">
        <div className="sh-print">
          <div className="fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stripUrl} alt="Hasil fotomu" />
          </div>
        </div>

        <div className="sh-side">
          <div>
            <span className="g-kicker">{done ? 'Selesai' : 'Sedang dicetak'}</span>
            <h1 className="g-title" style={{ marginTop: 8 }}>
              {done ? 'Fotomu sudah jadi!' : 'Tunggu sebentar, ya…'}
            </h1>
          </div>

          <div className="sh-card">
            <span className="sh-icon">{done ? <Check /> : <Printer />}</span>
            <div style={{ flex: 1 }}>
              <h3>{done ? 'Ambil cetakanmu' : `Mencetak ${Math.min(printed + 1, session.prints)} dari ${session.prints} lembar`}</h3>
              <p>{done ? 'Ada di slot printer di samping booth.' : 'Jangan tinggalkan booth dulu.'}</p>
              {!done && (
                <div className="sh-progress">
                  <span style={{ width: `${((printed + 0.5) / session.prints) * 100}%` }} />
                </div>
              )}
            </div>
          </div>

          <div className="sh-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sh-qr" src={qrDataUrl} alt="QR untuk menyimpan foto ke HP" />
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 26, height: 26, color: 'var(--primary)', display: 'inline-flex' }}>
                  <Phone />
                </span>
                Simpan ke HP
              </h3>
              <p>Scan pakai kamera HP untuk download fotomu. Link berlaku {retentionHours} jam.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="g-bar">
        <div>
          <div className="g-bar-label">{done ? 'Kembali ke awal dalam' : 'Terima kasih sudah mampir!'}</div>
          <div className="g-bar-value">{done ? formatClock(left) : 'SnaploreBooth'}</div>
        </div>
        <span className="g-spacer" />
        <button className="g-cta" onClick={finish} disabled={!done}>
          <Check /> Selesai
        </button>
      </div>
    </main>
  );
}
