import { headers } from 'next/headers';
import Link from 'next/link';
import QRCode from 'qrcode';
import EventPanel from '@/components/EventPanel';
import { boothStatus, listSessions, revenueToday } from '@/lib/db';
import { currentEvent, priceOf } from '@/lib/events';
import { ADDONS, PACKAGES, formatPrice } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';
import { isTestMode } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  capturing: 'foto',
  reviewing: 'hias',
  ready: 'siap',
  printing: 'cetak',
  done: 'selesai',
};

export default async function OperatorPage() {
  const sessions = listSessions(40);
  const status = boothStatus();
  const revenue = revenueToday();
  const payments = paymentsEnabled();
  const event = currentEvent();
  const prices = Object.fromEntries([...PACKAGES, ...ADDONS].map((item) => [item.id, priceOf(event, item.id)]));

  const headerList = await headers();
  const base =
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ??
    `${headerList.get('x-forwarded-proto') ?? 'http'}://${headerList.get('host') ?? 'localhost:4300'}`;
  const galleryUrl = `${base}/g/${event.slug}`;
  const galleryQr = await QRCode.toDataURL(galleryUrl, { margin: 1, width: 240 });

  return (
    <main className="kiosk">
      <div className="topbar">
        <div className="brand">
          <strong>Konsol Operator</strong>
          <span className="mono">SNAPLOREBOOTH</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link className="pill pill-ghost pill-sm" href="/operator/camera" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Kamera
          </Link>
          <Link className="pill pill-sm" href="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Kembali ke Booth
          </Link>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="mono">SESI HARI INI</span>
          <b>{status.sessions_today}</b>
        </div>
        <div className="stat">
          <span className="mono">CETAKAN HARI INI</span>
          <b>{status.prints_today}</b>
          <span className="mono mono-sm">{event.print_mode === 'airprint' ? 'AIRPRINT' : 'PRINTER SIMULASI'}</span>
        </div>
        <div className="stat">
          <span className="mono">SISA KERTAS (PERKIRAAN)</span>
          <b>{status.paper_percent}%</b>
          <span className="mono mono-sm">±{status.prints_remaining} LEMBAR LAGI</span>
        </div>
        <div className="stat">
          <span className="mono">PENDAPATAN HARI INI</span>
          <b style={{ fontSize: 24 }}>{formatPrice(revenue.amountIdr)}</b>
          <span className="mono mono-sm">
            {!payments
              ? 'TAMU GRATIS DI ACARA INI'
              : `${revenue.payments} PEMBAYARAN LUNAS${isTestMode() ? ' · MODE TES' : ''}`}
          </span>
        </div>
      </div>

      <div className="kiosk-body">
      <section className="col-deck scroll" style={{ flex: '0 0 400px' }}>
        <EventPanel event={event} prices={prices} galleryUrl={galleryUrl} galleryQr={galleryQr} xenditReady={!!process.env.XENDIT_SECRET_KEY} />
      </section>
      <div className="panel scroll" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <h3 style={{ marginBottom: '0.75rem' }}>Sesi terakhir</h3>
        {sessions.length === 0 ? (
          <p className="muted">Belum ada sesi. Booth siap dipakai.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Sesi</th>
                <th>Mulai</th>
                <th>Paket</th>
                <th>Foto</th>
                <th>Cetak</th>
                <th>Status</th>
                <th>Harga</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.id}</td>
                  <td>{new Date(s.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    {s.package_label} <span className="mono mono-sm">{s.format}</span>
                  </td>
                  <td>
                    {s.photo_count}/{s.shots}
                  </td>
                  <td>{s.prints}</td>
                  <td>
                    <span className="badge">{STATUS_LABEL[s.status] ?? s.status}</span>
                  </td>
                  <td>{s.requires_payment ? formatPrice(s.price_idr) : <span className="muted">gratis</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </main>
  );
}
