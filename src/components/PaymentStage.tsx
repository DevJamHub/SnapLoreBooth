'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useIdle } from '@/components/guest/hooks';
import { ArrowLeft, Check, Retry } from '@/components/guest/icons';
import { formatPrice } from '@/lib/packages';
import type { Session } from '@/lib/types';

interface PublicPayment {
  status: 'pending' | 'paid' | 'expired';
  amount_idr: number;
  qr_string: string;
  expires_at: string;
}

interface PaymentResponse {
  payment?: PublicPayment | null;
  required?: boolean;
  testMode?: boolean;
  error?: string;
}

const POLL_MS = 2500;
/** Only once the code has expired: a guest paying on their phone does not touch the booth. */
const IDLE_AFTER_EXPIRY_MS = 45_000;

export default function PaymentStage({ session }: { session: Session }) {
  const router = useRouter();
  const [payment, setPayment] = useState<PublicPayment | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback(
    (data: PaymentResponse) => {
      if (data.required === false) {
        router.replace(`/capture/${session.id}`);
        return;
      }
      if (data.payment) setPayment(data.payment);
      setTestMode(data.testMode === true);
    },
    [router, session.id],
  );

  const issue = useCallback(async () => {
    setIssuing(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sessions/${session.id}/payment`, { method: 'POST' });
      if (!res.ok) throw new Error();
      apply((await res.json()) as PaymentResponse);
    } catch {
      setFailed(true);
    } finally {
      setIssuing(false);
    }
  }, [apply, session.id]);

  useEffect(() => {
    void issue();
  }, [issue]);

  useEffect(() => {
    if (!payment?.qr_string) return;
    let cancelled = false;
    QRCode.toDataURL(payment.qr_string, { margin: 0, width: 640, color: { dark: '#181816', light: '#ffffff' } })
      .then((url) => !cancelled && setQrImage(url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [payment?.qr_string]);

  const pending = payment?.status === 'pending';
  const paid = payment?.status === 'paid';
  const secondsLeft = pending ? (new Date(payment.expires_at).getTime() - now) / 1000 : 0;
  const expired = payment?.status === 'expired' || (pending && secondsLeft <= 0);

  // The server settles from Xendit on each poll, so the booth moves on even without a webhook.
  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}/payment`, { cache: 'no-store' });
        if (res.ok) apply((await res.json()) as PaymentResponse);
      } catch {
        // A dropped poll is retried on the next tick; the code on screen stays valid.
      }
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [apply, pending, session.id]);

  useEffect(() => {
    if (!paid) return;
    const timer = setTimeout(() => router.replace(`/capture/${session.id}`), 1800);
    return () => clearTimeout(timer);
  }, [paid, router, session.id]);

  useIdle(expired || failed ? IDLE_AFTER_EXPIRY_MS : null, () => router.replace('/'));

  const simulate = async () => {
    setSimulating(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/payment/simulate`, { method: 'POST' });
      if (res.ok) apply((await res.json()) as PaymentResponse);
    } finally {
      setSimulating(false);
    }
  };

  const prints = `${session.prints} lembar cetak`;

  return (
    <main className="g-screen">
      <GuestHeader
        step="bayar"
        payments
        left={
          paid ? undefined : (
            <button className="g-ghost" onClick={() => (pending && !expired ? setConfirmCancel(true) : router.replace('/'))}>
              <ArrowLeft /> Batal
            </button>
          )
        }
        right={
          testMode &&
          pending &&
          !expired && (
            <button className="g-ghost" onClick={simulate} disabled={simulating} style={{ fontSize: 15, minHeight: 48 }}>
              {simulating ? 'Memproses…' : 'Simulasi bayar'}
            </button>
          )
        }
      />

      <div className="pay-layout">
        <div className="pay-copy">
          {paid ? (
            <>
              <span className="g-kicker">Pembayaran diterima</span>
              <h1 className="g-title">Makasih! Siap-siap bergaya ya.</h1>
              <p className="g-lead">Kamera akan menyala sebentar lagi.</p>
            </>
          ) : (
            <>
              <span className="g-kicker">Scan QRIS</span>
              <h1 className="g-title">Scan pakai aplikasi apa saja</h1>
              <div>
                <div className="pay-amount">{formatPrice(payment?.amount_idr ?? session.price_idr)}</div>
                <p className="pay-summary" style={{ marginTop: 10 }}>
                  {session.package_label} · {prints}
                </p>
              </div>
              <div className="pay-apps">
                {['GoPay', 'OVO', 'DANA', 'ShopeePay', 'LinkAja', 'm-Banking'].map((app) => (
                  <span key={app}>{app}</span>
                ))}
              </div>
              <p className="g-lead" style={{ fontSize: 17 }}>
                Booth lanjut sendiri begitu pembayaranmu masuk. Tidak perlu sentuh apa-apa.
              </p>
            </>
          )}
        </div>

        <div className="pay-qr-col">
          <div className="qr-card">
            {testMode && !paid && <span className="qr-badge">MODE TES</span>}
            {paid ? (
              <div className="qr-state">
                <span className="qr-paid">
                  <Check />
                </span>
                Lunas
              </div>
            ) : failed ? (
              <div className="qr-state">
                QRIS belum bisa dibuat.
                <button className="g-cta" onClick={issue} disabled={issuing} style={{ minHeight: 60, fontSize: 18 }}>
                  <Retry /> Coba lagi
                </button>
              </div>
            ) : expired ? (
              <div className="qr-state">
                Kode QR sudah kedaluwarsa.
                <button className="g-cta" onClick={issue} disabled={issuing} style={{ minHeight: 60, fontSize: 18 }}>
                  <Retry /> Buat kode baru
                </button>
              </div>
            ) : qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImage} alt="Kode QRIS untuk pembayaran" />
            ) : (
              <div className="qr-state">Menyiapkan QRIS…</div>
            )}
          </div>
          {pending && !expired && (
            <span className="waiting">
              <i /> Menunggu pembayaran · berlaku {formatClock(secondsLeft)}
            </span>
          )}
        </div>
      </div>

      {confirmCancel && (
        <div className="g-modal-backdrop" onClick={() => setConfirmCancel(false)}>
          <div className="g-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Batalkan sesi ini?</h2>
            <p>
              Kalau kamu <b style={{ color: 'var(--text)' }}>sudah scan dan membayar</b>, jangan dibatalkan — tunggu beberapa detik,
              booth akan lanjut sendiri.
            </p>
            <div className="g-modal-actions">
              <button className="g-cta" onClick={() => setConfirmCancel(false)} style={{ minHeight: 64, fontSize: 19 }}>
                Lanjut bayar
              </button>
              <button className="g-ghost" onClick={() => router.replace('/')}>
                Ya, batalkan
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
