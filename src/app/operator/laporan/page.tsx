import Link from 'next/link';
import OperatorHeader from '@/components/OperatorHeader';
import { currentEvent } from '@/lib/events';
import { formatPrice } from '@/lib/packages';
import { RANGES, buildReport, rangeOf } from '@/lib/reports';

export const dynamic = 'force-dynamic';

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function Bars({ items }: { items: { key: string; label: string; value: number; title: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="op-chart" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div key={item.key} className="op-chart-col" title={item.title}>
          <span className="op-chart-bar" style={{ height: `${(item.value / max) * 100}%` }} data-empty={item.value === 0} />
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

function Ranking({ title, rows, unit }: { title: string; rows: { label: string; count: number }[]; unit: string }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <section className="op-card">
      <div className="op-card-head">
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="op-muted">Belum ada data.</p>
      ) : (
        <ul className="op-rank">
          {rows.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <b>
                {r.count} {unit}
              </b>
              <i style={{ width: percent(r.count, total) }} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Konsol → Laporan: sales and what guests chose, over a range, with exports. */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const range = rangeOf((await searchParams).r);
  const report = buildReport(range);
  const event = currentEvent();
  const charged = report.paid + report.unpaid;

  const firstHour = Math.min(8, ...report.hours.flatMap((n, h) => (n > 0 ? [h] : [])));
  const lastHour = Math.max(22, ...report.hours.flatMap((n, h) => (n > 0 ? [h] : [])));
  const hours = report.hours.slice(firstHour, lastHour + 1).map((n, i) => ({
    key: String(firstHour + i),
    label: String(firstHour + i).padStart(2, '0'),
    value: n,
    title: `${String(firstHour + i).padStart(2, '0')}.00 · ${n} sesi`,
  }));

  return (
    <main className="op">
      <OperatorHeader active="laporan" />

      <div className="op-report-head">
        <div className="segmented op-range">
          {RANGES.map((r) => (
            <Link key={r.id} href={`/operator/laporan?r=${r.id}`} aria-pressed={r.id === range} className="op-range-link">
              {r.label}
            </Link>
          ))}
        </div>
        <a className="pill pill-ghost pill-sm" href={`/api/operator/export?kind=csv&r=${range}`}>
          Unduh CSV
        </a>
      </div>

      <section className="op-kpis">
        <div className="op-kpi op-kpi-lead">
          <span className="op-label">Pendapatan</span>
          <b>{formatPrice(report.revenue)}</b>
          <span className="op-muted">{report.paid} pembayaran lunas</span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Sesi</span>
          <b>{report.sessions}</b>
          <span className="op-muted">{report.finished} sampai cetak · {percent(report.finished, report.sessions)}</span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Rata-rata per tamu</span>
          <b>{report.average ? formatPrice(report.average) : '—'}</b>
          <span className="op-muted">dari sesi yang lunas</span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Tingkat bayar</span>
          <b>{percent(report.paid, charged)}</b>
          <span className="op-muted">
            {report.unpaid} batal di QRIS{report.free ? ` · ${report.free} gratis` : ''}
          </span>
        </div>
        <div className="op-kpi">
          <span className="op-label">Lembar dicetak</span>
          <b>{report.prints}</b>
          <span className="op-muted">termasuk cetak tambahan</span>
        </div>
      </section>

      <div className="op-report-grid">
        {report.days.length > 0 && (
          <section className="op-card op-report-wide">
            <div className="op-card-head">
              <h2>Pendapatan per hari</h2>
              <span className="op-muted">{formatPrice(report.revenue)}</span>
            </div>
            <Bars
              items={report.days.map((d) => ({
                key: d.day,
                label: report.days.length > 10 ? d.label.split(' ')[0] : d.label,
                value: d.revenue || d.sessions * 0.0001,
                title: `${d.label} · ${formatPrice(d.revenue)} · ${d.sessions} sesi`,
              }))}
            />
          </section>
        )}

        <section className="op-card op-report-wide">
          <div className="op-card-head">
            <h2>Jam ramai</h2>
            <span className="op-muted">sesi dimulai per jam</span>
          </div>
          <Bars items={hours} />
        </section>

        <section className="op-card">
          <div className="op-card-head">
            <h2>Per paket</h2>
          </div>
          {report.packages.length === 0 ? (
            <p className="op-muted">Belum ada sesi di rentang ini.</p>
          ) : (
            <table className="op-table">
              <thead>
                <tr>
                  <th>Paket</th>
                  <th className="op-num">Sesi</th>
                  <th className="op-num">Pendapatan</th>
                </tr>
              </thead>
              <tbody>
                {report.packages.map((p) => (
                  <tr key={p.label}>
                    <td>{p.label}</td>
                    <td className="op-num">{p.sessions}</td>
                    <td className="op-num">{formatPrice(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <Ranking title="Bingkai favorit" rows={report.frames} unit="lembar" />
        <Ranking title="Gaya warna" rows={report.filters} unit="lembar" />
        <Ranking title="Mode beauty" rows={report.beauty} unit="lembar" />

        <section className="op-card">
          <div className="op-card-head">
            <h2>Unduh foto acara</h2>
          </div>
          <p className="op-muted">
            {event.name}: semua lembar jadi dalam satu ZIP, untuk diserahkan ke klien atau dicadangkan. Hanya yang masih tersimpan
            di server.
          </p>
          <div className="op-row">
            <a className="pill pill-sm" href={`/api/operator/export?kind=zip&event=${event.id}`}>
              Lembar jadi (ZIP)
            </a>
            <a className="pill pill-ghost pill-sm" href={`/api/operator/export?kind=zip&event=${event.id}&all=1`}>
              Semua foto & video (ZIP)
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
