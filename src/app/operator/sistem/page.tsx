import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import OperatorHeader from '@/components/OperatorHeader';
import { configuredBackend } from '@/lib/camera';
import { getConfig } from '@/lib/config';
import { formatBytes } from '@/lib/format';
import { cloudEnabled } from '@/lib/cloud';
import { DATA_DIR, db } from '@/lib/db';
import { currentEvent } from '@/lib/events';
import { boothDevices } from '@/lib/heartbeat';
import { printerUri } from '@/lib/printer';
import { quickTunnelUrl } from '@/lib/publicUrl';
import { guestDataUsage } from '@/lib/retention';
import { isTestMode } from '@/lib/xendit';

export const dynamic = 'force-dynamic';

type Level = 'ok' | 'warn' | 'bad';
interface Check {
  label: string;
  value: string;
  level: Level;
  hint?: string;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
}

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const anyExists = (paths: string[]) => paths.some((p) => existsSync(p));

/** Developer mode: is every part of the booth in a state to run an event? Read-only. */
export default async function SystemPage() {
  const config = getConfig();
  const event = currentEvent();
  const usage = await guestDataUsage();
  const devices = boothDevices();
  // The write-ahead log holds recent changes until SQLite folds them in; both are the database.
  const dbBytes = (
    await Promise.all(['booth.db', 'booth.db-wal'].map((f) => fs.stat(path.join(DATA_DIR, f)).then((st) => st.size, () => 0)))
  ).reduce((a, b) => a + b, 0);
  const disk = await fs.statfs(DATA_DIR).catch(() => null);
  const free = disk ? disk.bavail * disk.bsize : null;

  const key = process.env.XENDIT_SECRET_KEY;
  const gphoto2 = anyExists([process.env.GPHOTO2_BIN ?? '', '/opt/homebrew/bin/gphoto2', '/usr/local/bin/gphoto2', '/usr/bin/gphoto2']);
  const ipptool = anyExists(['/usr/bin/ipptool', '/usr/sbin/ipptool']);
  const printer = printerUri();
  const tunnel = await quickTunnelUrl();

  const groups: { title: string; checks: Check[] }[] = [
    {
      title: 'Server',
      checks: [
        { label: 'Berjalan', value: duration(process.uptime()), level: 'ok' },
        { label: 'Node.js', value: process.version, level: 'ok' },
        { label: 'Mode', value: process.env.NODE_ENV === 'production' ? 'produksi (npm start)' : 'pengembangan (npm run dev)', level: process.env.NODE_ENV === 'production' ? 'ok' : 'warn' },
        {
          label: 'Alamat publik',
          value: process.env.PUBLIC_BASE_URL ?? (tunnel ? `${tunnel} (tunnel, otomatis)` : 'mengikuti alamat yang dibuka'),
          level: process.env.PUBLIC_BASE_URL || tunnel ? 'ok' : 'warn',
          hint: process.env.PUBLIC_BASE_URL
            ? undefined
            : tunnel
              ? 'QR tamu memakai tunnel ini. Buka layar booth di http://localhost:4300 (atau IP Wi-Fi Mac di iPad) agar live view kamera mulus.'
              : 'Tunnel tidak berjalan: QR tamu memakai alamat yang sedang dibuka. Jalankan npm run tunnel, atau isi PUBLIC_BASE_URL saat sudah punya domain.',
        },
      ],
    },
    {
      title: 'Data',
      checks: [
        { label: 'Database (SQLite)', value: `${formatBytes(dbBytes)} · ${count('events')} acara · ${count('sessions')} sesi · ${count('frames')} frame`, level: 'ok' },
        {
          label: 'Foto & video tamu',
          value: `${formatBytes(usage.bytes)} · foto dihapus setelah ${config.storage.photoHours} jam, video setelah ${config.storage.videoHours} jam`,
          level: 'ok',
        },
        {
          label: 'Ruang disk tersisa',
          value: free === null ? 'tidak terbaca' : formatBytes(free),
          level: free === null ? 'warn' : free < 500e6 ? 'bad' : free < 2e9 ? 'warn' : 'ok',
          hint: free !== null && free < 2e9 ? 'Kosongkan disk atau hapus foto tamu lama sebelum acara.' : undefined,
        },
        {
          label: 'Cadangan cloud (R2)',
          value: cloudEnabled() ? 'aktif' : 'tidak aktif',
          level: cloudEnabled() ? 'ok' : 'warn',
          hint: cloudEnabled() ? undefined : 'Foto hanya ada di server ini; backup folder data/ secara berkala.',
        },
      ],
    },
    {
      title: 'Pembayaran',
      checks: [
        { label: 'Acara ini', value: event.payment_mode === 'qris' ? 'QRIS' : 'gratis untuk tamu', level: 'ok' },
        {
          label: 'Kunci Xendit',
          value: !key ? 'belum diisi' : isTestMode() ? 'mode tes (uang tidak sungguhan)' : 'live',
          level: !key ? (event.payment_mode === 'qris' ? 'bad' : 'warn') : isTestMode() ? 'warn' : 'ok',
        },
        {
          label: 'Webhook Xendit',
          value: process.env.XENDIT_CALLBACK_TOKEN ? 'aktif' : 'tidak aktif (cek status tiap 3 detik)',
          level: process.env.XENDIT_CALLBACK_TOKEN ? 'ok' : 'warn',
        },
      ],
    },
    {
      title: 'Perangkat',
      checks: [
        {
          label: 'Kamera eksternal',
          value: configuredBackend === 'gphoto2' ? (gphoto2 ? 'tersedia (gphoto2)' : 'gphoto2 tidak ditemukan') : configuredBackend,
          level: configuredBackend === 'gphoto2' && !gphoto2 ? 'bad' : 'ok',
        },
        {
          label: 'Printer dipantau',
          value: printer ?? 'belum dipilih',
          level: printer ? 'ok' : 'warn',
          hint: printer ? undefined : 'Pilih di Ringkasan → Printer & kertas.',
        },
        { label: 'Pembaca printer (ipptool)', value: ipptool ? 'tersedia' : 'tidak ada', level: ipptool ? 'ok' : 'warn' },
        {
          label: 'Layar booth',
          value: devices.length ? `${devices.filter((d) => d.online).length} online dari ${devices.length}` : 'belum ada yang terhubung',
          level: devices.some((d) => d.online) ? 'ok' : 'warn',
        },
      ],
    },
  ];

  return (
    <main className="op">
      <OperatorHeader active="sistem" />

      <div className="op-sys">
        {groups.map((group) => (
          <section key={group.title} className="op-card">
            <div className="op-card-head">
              <h2>{group.title}</h2>
            </div>
            <ul className="calib-list">
              {group.checks.map((check) => (
                <li key={check.label} data-level={check.level === 'bad' ? 'bad' : check.level}>
                  <b>
                    {check.label}: <span className="op-sys-value">{check.value}</span>
                  </b>
                  {check.hint && <span>{check.hint}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="op-card">
          <div className="op-card-head">
            <h2>Layar booth (detail)</h2>
          </div>
          {devices.length === 0 ? (
            <p className="op-muted">Belum ada.</p>
          ) : (
            <table className="op-table">
              <thead>
                <tr>
                  <th>Perangkat</th>
                  <th>Layar</th>
                  <th className="op-num">Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.device}
                      <small className="op-muted" style={{ display: 'block' }}>
                        {d.id.slice(0, 8)} · {d.screen} · {d.camera}
                      </small>
                    </td>
                    <td>{d.online ? `${d.page}${d.session ? ` · ${d.session}` : ''}` : 'offline'}</td>
                    <td className="op-num">{new Date(d.seenAt).toLocaleTimeString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="op-card">
          <div className="op-card-head">
            <h2>Cadangan & ekspor</h2>
          </div>
          <p className="op-muted">
            Database berisi acara, sesi, pembayaran, harga, frame, dan pengaturan (foto tidak ikut; unduh foto acara di Laporan).
            Simpan berkala di luar laptop booth.
          </p>
          <div className="op-row">
            <a className="pill pill-sm" href="/api/operator/export?kind=db">
              Unduh cadangan database
            </a>
            <a className="pill pill-ghost pill-sm" href="/api/operator/export?kind=csv&r=all">
              Semua sesi (CSV)
            </a>
            <a className="pill pill-ghost pill-sm" href="/operator/pengaturan#set-storage">
              Penyimpanan
            </a>
          </div>
        </section>

        <section className="op-card">
          <div className="op-card-head">
            <h2>Data mentah</h2>
          </div>
          <p className="op-muted">Untuk developer: status dalam bentuk JSON.</p>
          <div className="op-row">
            <a className="pill pill-ghost pill-sm" href="/api/status" target="_blank" rel="noreferrer">
              /api/status
            </a>
            <a className="pill pill-ghost pill-sm" href="/api/camera" target="_blank" rel="noreferrer">
              /api/camera
            </a>
            <a className="pill pill-ghost pill-sm" href="/api/operator/printer" target="_blank" rel="noreferrer">
              /api/operator/printer
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
