'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useCountdown, useIdle } from '@/components/guest/hooks';
import { Check, Phone, Printer, Retry } from '@/components/guest/icons';
import { composeLive, type LiveSlot } from '@/lib/strip';
import type { PrintMode, Session } from '@/lib/types';

/** Seconds one copy takes in simulated mode, roughly a dye-sub printer. */
const SECONDS_PER_COPY = 4;
const FINISH_AFTER_SECONDS = 45;
/** A guest who walks away before tapping Cetak should not hold the booth forever. */
const ABANDONED_MS = 3 * 60_000;

/** A 2x6 strip prints two-up on a 4x6 sheet and is cut in half, so two strips cost one sheet. */
function sheetsFor(session: Session): number {
  return session.format === '2x6' ? Math.ceil(session.prints / 2) : session.prints;
}

function formatRetention(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} hari` : `${hours} jam`;
}

export default function ShareStage({
  session,
  stripUrl,
  qrDataUrl,
  retentionHours,
  payments,
  gallery,
  printMode,
  eventName,
  liveSlots,
  liveUrl: savedLiveUrl,
}: {
  session: Session;
  stripUrl: string;
  qrDataUrl: string;
  retentionHours: number;
  payments: boolean;
  gallery: boolean;
  printMode: PrintMode;
  eventName: string;
  liveSlots: LiveSlot[];
  liveUrl: string | null;
}) {
  const router = useRouter();
  const sheets = sheetsFor(session);
  const [printed, setPrinted] = useState(0);
  const [sentToPrinter, setSentToPrinter] = useState(false);
  const [inGallery, setInGallery] = useState(session.in_gallery);

  const simulated = printMode === 'simulated';
  const done = simulated ? printed >= sheets : sentToPrinter;

  const canMakeLive = !savedLiveUrl && liveSlots.some((s) => s.clip);
  const [live, setLive] = useState<'idle' | 'making' | 'ready' | 'none'>(savedLiveUrl ? 'ready' : canMakeLive ? 'making' : 'none');

  // The live sheet is recorded while the printer works, then uploaded for the QR page and the
  // event screen. This screen itself keeps showing the still: it is what comes out of the printer.
  useEffect(() => {
    if (!canMakeLive) return;
    let cancelled = false;
    composeLive(liveSlots, {
      format: session.format,
      filterId: session.filter,
      templateId: session.template,
      eventName,
      capturedAt: new Date(session.created_at),
    })
      .then(async (blob) => {
        if (cancelled) return;
        if (!blob) return setLive('none');
        await fetch(`/api/sessions/${session.id}/live`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        if (!cancelled) setLive('ready');
      })
      .catch(() => !cancelled && setLive('none'));
    return () => {
      cancelled = true;
    };
    // Once per visit: the inputs are fixed for a finished session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busyMakingLive = live === 'making';

  useEffect(() => {
    if (!simulated || done) return;
    const timer = setTimeout(() => setPrinted((n) => n + 1), SECONDS_PER_COPY * 1000);
    return () => clearTimeout(timer);
  }, [done, printed, simulated]);

  // iOS hands the job to AirPrint and returns; afterprint is the only signal it gives.
  useEffect(() => {
    if (simulated) return;
    const onAfterPrint = () => setSentToPrinter(true);
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [simulated]);

  useEffect(() => {
    if (!done) return;
    void fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
  }, [done, session.id]);

  const toggleGallery = () => {
    const next = !inGallery;
    setInGallery(next);
    void fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ in_gallery: next }),
    });
  };

  const finish = () => router.replace('/');
  // Leaving mid-recording would lose the live sheet, so the booth waits the few seconds it takes.
  const left = useCountdown(FINISH_AFTER_SECONDS, done && !busyMakingLive, finish);
  useIdle(done ? null : ABANDONED_MS, finish);

  const printCard = simulated ? (
    <div className="sh-card">
      <span className="sh-icon">{done ? <Check /> : <Printer />}</span>
      <div style={{ flex: 1 }}>
        <h3>{done ? 'Ambil cetakanmu' : `Mencetak ${Math.min(printed + 1, sheets)} dari ${sheets} lembar`}</h3>
        <p>{done ? 'Ada di slot printer di samping booth.' : 'Jangan tinggalkan booth dulu.'}</p>
        {!done && (
          <div className="sh-progress">
            <span style={{ width: `${((printed + 0.5) / sheets) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="sh-card">
      <span className="sh-icon">{done ? <Check /> : <Printer />}</span>
      <div style={{ flex: 1 }}>
        <h3>{done ? 'Ambil cetakanmu' : `Cetak ${sheets} lembar`}</h3>
        <p>
          {done
            ? 'Sudah dikirim ke printer. Kalau tidak keluar, tekan Cetak ulang.'
            : 'Tekan Cetak, pilih printer booth, lalu Print.'}
        </p>
      </div>
      <button className={done ? 'g-ghost' : 'g-cta'} onClick={() => window.print()} style={done ? undefined : { minHeight: 64, fontSize: 19 }}>
        {done ? (
          <>
            <Retry /> Cetak ulang
          </>
        ) : (
          <>
            <Printer /> Cetak
          </>
        )}
      </button>
    </div>
  );

  return (
    <>
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
              <span className="g-kicker">{done ? 'Selesai' : simulated ? 'Sedang dicetak' : 'Siap dicetak'}</span>
              <h1 className="g-title" style={{ marginTop: 8 }}>
                {done ? 'Fotomu sudah jadi!' : simulated ? 'Tunggu sebentar, ya…' : 'Fotomu sudah jadi!'}
              </h1>
            </div>

            {printCard}

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
                <p>
                  Scan pakai kamera HP untuk download foto{live === 'none' ? '' : ' & video live'}. Link berlaku{' '}
                  {formatRetention(retentionHours)}.
                </p>
                {live === 'making' && <p className="sh-live-note">Video live sedang dibuat…</p>}
                {live === 'ready' && <p className="sh-live-note">Video live siap ✓</p>}
              </div>
            </div>

            {gallery && (
              <button className="addon" aria-pressed={inGallery} onClick={toggleGallery} style={{ alignSelf: 'flex-start' }}>
                <span className="switch" />
                Tampilkan di galeri acara
              </button>
            )}
          </div>
        </div>

        <div className="g-bar">
          <div>
            <div className="g-bar-label">{done ? 'Kembali ke awal dalam' : 'Terima kasih sudah mampir!'}</div>
            <div className="g-bar-value">{done ? formatClock(left) : 'SnaploreBooth'}</div>
          </div>
          <span className="g-spacer" />
          <button className="g-cta" onClick={finish} disabled={(simulated && !done) || busyMakingLive}>
            <Check /> {busyMakingLive ? 'Menyimpan video…' : 'Selesai'}
          </button>
        </div>
      </main>

      {/* Only this reaches the paper: 4x6in sheets, strips two-up for cutting. */}
      <div className="print-only" aria-hidden="true">
        {Array.from({ length: sheets }, (_, i) => (
          <div key={i} className="print-sheet" data-format={session.format}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stripUrl} alt="" />
            {session.format === '2x6' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stripUrl} alt="" />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
