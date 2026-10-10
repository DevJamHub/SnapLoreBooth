import QRCode from 'qrcode';
import AutoRefresh from '@/components/AutoRefresh';
import CopyButton from '@/components/CopyButton';
import EventArchive from '@/components/EventArchive';
import EventPanel from '@/components/EventPanel';
import GuestDataPanel from '@/components/GuestDataPanel';
import OperatorHeader from '@/components/OperatorHeader';
import PrinterPanel from '@/components/PrinterPanel';
import PromoPanel from '@/components/PromoPanel';
import SessionLog from '@/components/SessionLog';
import { boothStatus, revenueToday, sessionCounts, sessionLog } from '@/lib/db';
import { currentEvent, listEvents, priceOf } from '@/lib/events';
import { boothDevices } from '@/lib/heartbeat';
import { ADDONS, PACKAGES, formatPrice } from '@/lib/packages';
import { paymentsEnabled } from '@/lib/payments';
import { publicBaseUrl } from '@/lib/publicUrl';
import { BULK_CONFIRM_FROM, PURGE_CONFIRMATION, guestDataUsage, isSessionActive, retentionHours } from '@/lib/retention';
import { listVouchers } from '@/lib/vouchers';
import { isTestMode } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

const time = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} detik lalu`;
  if (s < 3600) return `${Math.round(s / 60)} menit lalu`;
  return `sejak ${time(new Date(ms).toISOString())}`;
}

export default async function OperatorPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const search = ((await searchParams).q ?? '').slice(0, 12);
  const log = sessionLog(60, search);
  const status = boothStatus();
  const revenue = revenueToday();
  const payments = paymentsEnabled();
  const testMode = isTestMode();
  const event = currentEvent();
  const prices = Object.fromEntries([...PACKAGES, ...ADDONS].map((item) => [item.id, priceOf(event, item.id)]));
  const usage = await guestDataUsage();
  const devices = boothDevices();
  const online = devices.filter((d) => d.online);

  const base = await publicBaseUrl();
  const galleryUrl = `${base}/g/${event.slug}`;
  const galleryQr = await QRCode.toDataURL(galleryUrl, { margin: 1, width: 240 });

  const counts = sessionCounts();
  const pastEvents = listEvents(30)
    .filter((e) => e.id !== event.id)
    .map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug,
      when: e.ended_at && day(e.ended_at) !== day(e.created_at) ? `${day(e.created_at)} – ${day(e.ended_at)}` : day(e.created_at),
      sessions: counts.get(e.id) ?? 0,
    }));

  const today = log.filter((row) => isToday(row.created_at));
  const paidToday = today.filter((row) => row.paid).length;
  const unpaidToday = today.filter((row) => row.requires_payment && !row.paid).length;

  return (
    <main className="op">
      <OperatorHeader active="ringkasan">
        <AutoRefresh renderedAt={new Date().toISOString()} />
        <span className="op-chip" data-tone={payments ? (testMode ? 'warn' : 'ok') : 'muted'}>
          {payments ? (testMode ? 'QRIS · mode tes' : 'QRIS · live') : 'Tamu gratis'}
        </span>
        <span className="op-chip" data-tone={event.print_mode === 'airprint' ? 'ok' : 'muted'}>
          {event.print_mode === 'airprint' ? 'AirPrint' : 'Cetak simulasi'}
        </span>
      </OperatorHeader>

      <section className="op-event">
        <div className="op-event-main">
          <span className="op-chip" data-tone={event.ended_at ? 'warn' : 'ok'}>
            {event.ended_at ? 'Acara selesai · galeri dibuka' : 'Acara berjalan'}
          </span>
          <h1>{event.name}</h1>
          <span className="op-muted">
            Dimulai {day(event.created_at)}, {time(event.created_at)}
            {event.ended_at ? ` · selesai ${day(event.ended_at)}, ${time(event.ended_at)}` : ''}
          </span>
        </div>
        {event.gallery && (
          <div className="op-event-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={galleryQr} alt="QR link acara" />
            <div>
              <span className="op-label">{event.ended_at ? 'Galeri foto' : 'Layar kedua'}</span>
              <span className="op-url">{galleryUrl.replace(/^https?:\/\//, '')}</span>
              <div className="op-row">
                <CopyButton text={galleryUrl} />
                <a className="pill pill-ghost pill-sm" href={galleryUrl} target="_blank" rel="noreferrer">
                  Buka
                </a>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="op-kpis">
        <div className="op-kpi op-kpi-lead">
          <span className="op-label">Pendapatan hari ini</span>
          <b>{formatPrice(revenue.amountIdr)}</b>
          <span className="op-muted">
            {payments ? `${revenue.payments} pembayaran lunas${testMode ? ' · uang tes' : ''}` : 'Acara ini gratis untuk tamu'}
          </span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Sesi hari ini</span>
          <b>{status.sessions_today}</b>
          <span className="op-muted">{unpaidToday > 0 ? `${unpaidToday} belum bayar` : 'semua tuntas'}</span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Lembar dicetak</span>
          <b>{status.prints_today}</b>
          <span className="op-muted">hari ini</span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Sisa kertas</span>
          <b>±{status.prints_remaining}</b>
          <span className="op-meter" aria-label={`${status.paper_percent}%`}>
            <span style={{ width: `${status.paper_percent}%` }} data-low={status.paper_percent < 15} />
          </span>
        </div>
      </section>

      <div className="op-watch">
        <section className="op-card">
          <div className="op-card-head">
            <h2>Booth</h2>
            <span className="op-chip" data-tone={online.length ? 'ok' : devices.length ? 'bad' : 'muted'}>
              {online.length ? `${online.length} online` : devices.length ? 'Offline' : 'Belum ada'}
            </span>
          </div>
          {devices.length === 0 ? (
            <p className="op-muted">Belum ada layar booth yang aktif. Buka booth di tablet atau laptop; muncul di sini dalam 30 detik.</p>
          ) : (
            <div className="op-list">
              {devices.map((d) => (
                <div key={d.id} className="op-device" data-online={d.online}>
                  <i />
                  <div>
                    <b>
                      {d.device} · {d.online ? d.page : 'offline'}
                    </b>
                    <span className="op-muted">
                      {[d.session, d.camera, d.battery !== null ? `baterai ${d.battery}%${d.charging ? ' (mengisi)' : ''}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <span className="op-muted op-device-seen">{ago(d.seenAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <PrinterPanel
          paper={{
            remaining: status.prints_remaining,
            capacity: status.paper_capacity,
            percent: status.paper_percent,
            loadedAt: status.paper_loaded_at,
          }}
        />
      </div>

      <div className="op-grid">
        <SessionLog
          rows={log.map((row) => ({
            id: row.id,
            time: time(row.created_at),
            day: isToday(row.created_at) ? null : day(row.created_at),
            price: formatPrice(row.price_idr),
            requiresPayment: row.requires_payment,
            paid: row.paid,
            inGallery: row.in_gallery,
            active: isSessionActive(row),
            done: row.done,
          }))}
          summary={search ? `${log.length} cocok` : `${today.length} hari ini${payments ? ` · ${paidToday} lunas` : ''}`}
          search={search}
          confirmWord={PURGE_CONFIRMATION}
          bulkFrom={BULK_CONFIRM_FROM}
        />

        <aside className="op-side">
          <EventPanel event={event} prices={prices} xenditReady={!!process.env.XENDIT_SECRET_KEY} />
          <PromoPanel initial={listVouchers()} payments={payments} />
          <EventArchive events={pastEvents} confirmWord={PURGE_CONFIRMATION} />
          <GuestDataPanel sessions={usage.sessions} bytes={usage.bytes} retentionHours={retentionHours()} confirmWord={PURGE_CONFIRMATION} />
        </aside>
      </div>
    </main>
  );
}
