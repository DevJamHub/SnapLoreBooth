'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatClock } from '@/components/guest/hooks';
import { Check, Retry } from '@/components/guest/icons';
import { useT } from '@/components/guest/lang';
import { formatPrice } from '@/lib/packages';

interface PublicPayment {
  status: 'pending' | 'paid' | 'expired';
  amount_idr: number;
  qr_string: string;
  expires_at: string;
}

interface ExtraResponse {
  payment?: PublicPayment;
  testMode?: boolean;
  error?: string;
}

const POLL_MS = 2500;

/**
 * "Cetak lagi": a QRIS code for `copies` more sheets of the guest's finished sheet. Paid, it hands
 * back to the print screen, which prints them. The server adds them to the session when it
 * settles the payment, so the paper count and the revenue include them.
 */
export default function ExtraPrintDialog({
  sessionId,
  copies,
  onPaid,
  onClose,
}: {
  sessionId: string;
  copies: number;
  onPaid: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback((data: ExtraResponse) => {
    if (data.payment) setPayment(data.payment);
    setTestMode(data.testMode === true);
  }, []);

  const issue = useCallback(async () => {
    setIssuing(true);
    setFailed(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/extra`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copies }),
      });
      const data = (await res.json()) as ExtraResponse;
      if (!res.ok || !data.payment) throw new Error(data.error);
      apply(data);
    } catch {
      setFailed(t('QRIS belum bisa dibuat.'));
    } finally {
      setIssuing(false);
    }
  }, [apply, copies, sessionId]);

  useEffect(() => {
    void issue();
  }, [issue]);

  useEffect(() => {
    if (!payment?.qr_string) return;
    let cancelled = false;
    QRCode.toDataURL(payment.qr_string, { margin: 0, width: 560, color: { dark: '#181816', light: '#ffffff' } })
      .then((url) => !cancelled && setQrImage(url))
      .catch(() => !cancelled && setFailed(t('QRIS belum bisa dibuat.')));
    return () => {
      cancelled = true;
    };
  }, [payment?.qr_string]);

  const pending = payment?.status === 'pending';
  const paid = payment?.status === 'paid';
  const secondsLeft = pending ? (new Date(payment.expires_at).getTime() - now) / 1000 : 0;
  const expired = payment?.status === 'expired' || (pending && secondsLeft <= 0);

  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let polling = false;
    const poll = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/extra`, { cache: 'no-store' });
        if (res.ok) apply((await res.json()) as ExtraResponse);
      } catch {
        // Retried on the next tick; the code on screen stays valid.
      } finally {
        polling = false;
      }
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [apply, pending, sessionId]);

  useEffect(() => {
    if (!paid) return;
    const timer = setTimeout(onPaid, 1200);
    return () => clearTimeout(timer);
  }, [paid, onPaid]);

  const simulate = async () => {
    setSimulating(true);
    try {
      await fetch(`/api/sessions/${sessionId}/payment/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'extra' }),
      });
      const res = await fetch(`/api/sessions/${sessionId}/extra`, { cache: 'no-store' });
      if (res.ok) apply((await res.json()) as ExtraResponse);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="g-modal-backdrop">
      <div className="g-modal sh-extra" role="dialog" aria-modal="true" aria-label={t('Bayar cetak lagi')}>
        <h2>{paid ? t('Pembayaran diterima') : t('Cetak lagi {n} lembar', { n: copies })}</h2>
        <p>{paid ? t('Siap dicetak sebentar lagi.') : t('Scan pakai aplikasi apa saja · {price}', { price: formatPrice(payment?.amount_idr ?? 0) })}</p>
        <div className="qr-card sh-extra-qr">
          {testMode && !paid && <span className="qr-badge">{t('MODE TES')}</span>}
          {paid ? (
            <div className="qr-state">
              <span className="qr-paid">
                <Check />
              </span>
              {t('Lunas')}
            </div>
          ) : failed || expired ? (
            <div className="qr-state">
              {failed ?? t('Kode QR sudah kedaluwarsa.')}
              <button className="g-cta" onClick={issue} disabled={issuing} style={{ minHeight: 56, fontSize: 17 }}>
                <Retry /> {t(failed ? 'Coba lagi' : 'Buat kode baru')}
              </button>
            </div>
          ) : qrImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrImage} alt={t('Kode QRIS untuk cetak lagi')} />
          ) : (
            <div className="qr-state">{t('Menyiapkan QRIS…')}</div>
          )}
        </div>
        {pending && !expired && (
          <span className="waiting">
            <i /> {t('Menunggu pembayaran · berlaku {time}', { time: formatClock(secondsLeft) })}
          </span>
        )}
        {!paid && confirmClose && (
          <p>{t('Kalau kamu sudah scan dan membayar, jangan ditutup — tunggu beberapa detik.')}</p>
        )}
        {!paid && (
          <div className="g-modal-actions">
            {testMode && pending && !expired && !confirmClose && (
              <button className="g-ghost" onClick={simulate} disabled={simulating}>
                {t(simulating ? 'Memproses…' : 'Simulasi bayar')}
              </button>
            )}
            {confirmClose && (
              <button className="g-cta" onClick={() => setConfirmClose(false)} style={{ minHeight: 56, fontSize: 17 }}>
                {t('Lanjut bayar')}
              </button>
            )}
            <button className="g-ghost" onClick={() => (pending && !expired && !confirmClose ? setConfirmClose(true) : onClose())}>
              {t(confirmClose ? 'Ya, tidak jadi' : 'Tidak jadi')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
