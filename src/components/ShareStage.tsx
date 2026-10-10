'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ExtraPrintDialog from '@/components/ExtraPrintDialog';
import GuestHeader from '@/components/guest/GuestHeader';
import { useLang, useT } from '@/components/guest/lang';
import { formatClock, useCountdown, useIdle } from '@/components/guest/hooks';
import { Check, Phone, Printer, Retry } from '@/components/guest/icons';
import { STRIP_FORMATS, formatPrice } from '@/lib/packages';
import { composeLive, type LiveSlot } from '@/lib/strip';
import type { CustomFrame, PrintMode, Session } from '@/lib/types';

/** Seconds one copy takes in simulated mode, roughly a dye-sub printer. */
const SECONDS_PER_COPY = 4;
/** A guest who walks away before tapping Cetak should not hold the booth forever. */
const ABANDONED_MS = 3 * 60_000;

/**
 * A strip (from packages no longer offered) prints two-up on a 4x6 sheet. An old 2x6 session
 * counted strips, so two cost one sheet; a Strip 4 Pose sold the sheet, two strips per print.
 */
function sheetsFor(session: Session): number {
  return session.format === '2x6' ? Math.ceil(session.prints / 2) : session.prints;
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
  frame,
  settings,
  showDate,
  printQr,
  upsell,
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
  frame: CustomFrame | null;
  /** Konsol → Pengaturan → Berbagi & galeri. */
  settings: {
    /** Back to standby this long after printing. */
    finishSeconds: number;
    qr: boolean;
    galleryChoice: boolean;
    /** Bitrate of the whole-sheet video; null makes none. */
    liveBitrate: number | null;
  };
  showDate: boolean;
  /** Built-in frames carry the QR in their footer; the live sheet shows it too. */
  printQr: boolean;
  /** "Cetak lagi" after printing: price per sheet and the most one guest may buy. Null offers none. */
  upsell: { price: number; max: number } | null;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const kept = retentionHours >= 48 && retentionHours % 24 === 0 ? t('{n} hari', { n: retentionHours / 24 }) : t('{n} jam', { n: retentionHours });
  // The sheets of this round: what was paid for, then any bought afterwards with "Cetak lagi".
  const [sheets, setSheets] = useState(() => sheetsFor(session));
  const [printed, setPrinted] = useState(0);
  const [sentToPrinter, setSentToPrinter] = useState(false);
  const [inGallery, setInGallery] = useState(session.in_gallery);
  const [extra, setExtra] = useState(1);
  const [buying, setBuying] = useState(false);

  const simulated = printMode === 'simulated';
  const done = simulated ? printed >= sheets : sentToPrinter;

  /** Paid: a new round of exactly the sheets bought, through the same print flow. */
  const startExtraRound = useCallback(() => {
    setBuying(false);
    setSheets(extra);
    setPrinted(0);
    setSentToPrinter(false);
    setExtra(1);
  }, [extra]);

  const canMakeLive = !savedLiveUrl && settings.liveBitrate !== null && liveSlots.some((s) => s.clip);
  const [live, setLive] = useState<'idle' | 'making' | 'ready' | 'none'>(savedLiveUrl ? 'ready' : canMakeLive ? 'making' : 'none');

  // The live sheet is recorded while the printer works, then uploaded for the QR page and the
  // event screen. This screen itself keeps showing the still: it is what comes out of the printer.
  useEffect(() => {
    if (!canMakeLive) return;
    let cancelled = false;
    composeLive(
      liveSlots,
      {
        format: session.format,
        filterId: session.filter,
        templateId: session.template,
        eventName,
        capturedAt: new Date(session.created_at),
        frame,
        mirror: session.mirror,
        showDate,
        qr: printQr ? qrDataUrl : null,
        decor: session.decor,
        lang,
      },
      undefined,
      settings.liveBitrate ?? undefined,
    )
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
  const left = useCountdown(settings.finishSeconds, done && !busyMakingLive && !buying, finish);
  // A guest who walks away mid-print, or from the "Cetak lagi" code, does not hold the booth.
  useIdle(done && !buying ? null : ABANDONED_MS, finish);

  // In the bottom bar once the sheets are out, so the QR beside the sheet stays in view.
  const moreSheets = upsell && done && (
    <div className="sh-more">
      <div className="sh-more-text">
        <b>{t('Mau cetak lagi?')}</b>
        <span>{t('{price}/lembar', { price: formatPrice(upsell.price) })}</span>
      </div>
      <div className="stepper" aria-label={t('Jumlah cetak lagi')}>
        <button className="stepper-btn" onClick={() => setExtra((n) => Math.max(n - 1, 1))} disabled={extra <= 1} aria-label={t('Kurangi')}>
          −
        </button>
        <div className="stepper-label">
          <b>{t('{n} lembar', { n: extra })}</b>
        </div>
        <button className="stepper-btn" onClick={() => setExtra((n) => Math.min(n + 1, upsell.max))} disabled={extra >= upsell.max} aria-label={t('Tambah')}>
          +
        </button>
      </div>
      <button className="g-cta sh-more-pay" onClick={() => setBuying(true)}>
        {formatPrice(extra * upsell.price)}
      </button>
    </div>
  );

  const printCard = simulated ? (
    <div className="sh-card">
      <span className="sh-icon">{done ? <Check /> : <Printer />}</span>
      <div style={{ flex: 1 }}>
        <h3>{done ? t('Ambil cetakanmu') : t('Mencetak {n} dari {total} lembar', { n: Math.min(printed + 1, sheets), total: sheets })}</h3>
        <p>{t(done ? 'Ada di slot printer di samping booth.' : 'Jangan tinggalkan booth dulu.')}</p>
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
        <h3>{done ? t('Ambil cetakanmu') : t('Cetak {n} lembar', { n: sheets })}</h3>
        <p>{t(done ? 'Sudah dikirim ke printer. Kalau tidak keluar, tekan Cetak ulang.' : 'Tekan Cetak, pilih printer booth, lalu Print.')}</p>
      </div>
      <button className={done ? 'g-ghost' : 'g-cta'} onClick={() => window.print()} style={done ? undefined : { minHeight: 64, fontSize: 19 }}>
        {done ? (
          <>
            <Retry /> {t('Cetak ulang')}
          </>
        ) : (
          <>
            <Printer /> {t('Cetak')}
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
              <img src={stripUrl} alt={t('Hasil fotomu')} />
            </div>
          </div>

          <div className="sh-side">
            <div>
              <span className="g-kicker">{t(done ? 'Selesai' : simulated ? 'Sedang dicetak' : 'Siap dicetak')}</span>
              <h1 className="g-title" style={{ marginTop: 8 }}>
                {t(done ? 'Fotomu sudah jadi!' : simulated ? 'Tunggu sebentar, ya…' : 'Fotomu sudah jadi!')}
              </h1>
            </div>

            {printCard}

            <div className="sh-card" hidden={!settings.qr}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="sh-qr" src={qrDataUrl} alt={t('QR untuk menyimpan foto ke HP')} />
              <div>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 26, height: 26, color: 'var(--primary)', display: 'inline-flex' }}>
                    <Phone />
                  </span>
                  {t('Simpan ke HP')}
                </h3>
                <p>
                  {t(live === 'none' ? 'Scan pakai kamera HP untuk download foto. Link berlaku {kept}.' : 'Scan pakai kamera HP untuk download foto & video live. Link berlaku {kept}.', {
                    kept,
                  })}
                </p>
                {live === 'making' && <p className="sh-live-note">{t('Video live sedang dibuat…')}</p>}
                {live === 'ready' && <p className="sh-live-note">{t('Video live siap ✓')}</p>}
              </div>
            </div>

            {gallery && settings.galleryChoice && (
              <button className="addon" aria-pressed={inGallery} onClick={toggleGallery} style={{ alignSelf: 'flex-start' }}>
                <span className="switch" />
                {t('Tampilkan di galeri acara')}
              </button>
            )}
          </div>
        </div>

        <div className="g-bar">
          <div>
            <div className="g-bar-label">{t(done ? 'Kembali ke awal dalam' : 'Terima kasih sudah mampir!')}</div>
            <div className="g-bar-value">{done ? formatClock(left) : 'SnaploreBooth'}</div>
          </div>
          <span className="g-spacer" />
          {moreSheets}
          <button className="g-cta" onClick={finish} disabled={(simulated && !done) || busyMakingLive}>
            <Check /> {t(busyMakingLive ? 'Menyimpan video…' : 'Selesai')}
          </button>
        </div>
      </main>

      {buying && <ExtraPrintDialog sessionId={session.id} copies={extra} onPaid={startExtraRound} onClose={() => setBuying(false)} />}

      {/* Only this reaches the paper: 4x6in sheets, strips two-up for cutting. */}
      <div className="print-only" aria-hidden="true">
        {Array.from({ length: sheets }, (_, i) => (
          <div key={i} className="print-sheet" data-format={session.format}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stripUrl} alt="" />
            {STRIP_FORMATS.includes(session.format) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stripUrl} alt="" />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
