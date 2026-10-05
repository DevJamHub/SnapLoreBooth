'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import StoragePanel from '@/components/StoragePanel';
import { CHOICES, VIDEO_BITRATES, type BoothConfig, type VideoQuality } from '@/lib/configShared';
import type { StorageBreakdown } from '@/lib/housekeeping';
import { BEAUTY, FILTERS, PACKAGES } from '@/lib/packages';
import { readJson } from '@/lib/readJson';

type Section = keyof BoothConfig;

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'standby', label: 'Layar awal' },
  { id: 'packages', label: 'Paket & cetak' },
  { id: 'flow', label: 'Alur & waktu' },
  { id: 'capture', label: 'Foto & pose' },
  { id: 'style', label: 'Gaya & beauty' },
  { id: 'share', label: 'Berbagi & galeri' },
  { id: 'storage', label: 'Penyimpanan' },
];

function seconds(n: number): string {
  if (n < 60) return `${n} detik`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m} menit ${s} detik` : `${m} menit`;
}

function hours(n: number): string {
  return n < 24 ? `${n} jam` : `${n / 24} hari`;
}

/** The given options, plus the current value when it is something else (set through the API). */
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function Card({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={`set-${id}`} className="op-card op-set-card">
      <div className="op-card-head">
        <h2>{title}</h2>
      </div>
      {intro && <p className="op-muted">{intro}</p>}
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="op-set-row">
      <div className="op-set-label">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </div>
      <div className="op-set-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="op-switch" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Segments<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, options, onChange, format }: { value: number; options: number[]; onChange: (v: number) => void; format: (n: number) => string }) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {withCurrent(options, value).map((n) => (
        <option key={n} value={n}>
          {format(n)}
        </option>
      ))}
    </select>
  );
}

function Checks({ options, value, locked = [], onChange }: { options: { id: string; label: string }[]; value: string[]; locked?: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="op-checks">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <label key={o.id} className="op-check-chip" data-on={on}>
            <input
              type="checkbox"
              checked={on}
              disabled={locked.includes(o.id)}
              onChange={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/** Rough size of one countdown clip at a quality, for the console to show the trade-off. */
function clipSize(quality: VideoQuality, countdown: number): string {
  const mb = (VIDEO_BITRATES[quality].clip * (countdown + 0.5)) / 8 / 1e6;
  return `±${mb.toFixed(1)} MB`;
}

/**
 * Konsol → Pengaturan: how the booth behaves, section by section. Changes are drafted here and
 * saved together; guest screens pick them up on their next page.
 */
export default function SettingsPanel({
  initial,
  defaults,
  storage,
  canShrink,
}: {
  initial: BoothConfig;
  defaults: BoothConfig;
  storage: StorageBreakdown;
  /** Whether this server can make camera photos smaller (macOS has sips). */
  canShrink: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [prompts, setPrompts] = useState(initial.capture.prompts.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  // Leaving with unsaved changes asks first, as any settings screen does.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <S extends Section, K extends keyof BoothConfig[S]>(section: S, key: K, value: BoothConfig[S][K]) => {
    setNotice(null);
    setDraft((d) => ({ ...d, [section]: { ...d[section], [key]: value } }));
  };

  const apply = (config: BoothConfig) => {
    setSaved(config);
    setDraft(config);
    setPrompts(config.capture.prompts.join('\n'));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await readJson<{ config?: BoothConfig }>(res);
      if (!res.ok || !data.config) throw new Error(data.error ?? 'gagal menyimpan');
      apply(data.config);
      setNotice('Tersimpan. Layar tamu memakainya mulai halaman berikutnya.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/settings', { method: 'DELETE' });
      const data = await readJson<{ config?: BoothConfig }>(res);
      if (!res.ok || !data.config) throw new Error(data.error ?? 'gagal mengembalikan');
      apply(data.config);
      setConfirmReset(false);
      setNotice('Semua pengaturan kembali ke bawaan.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mengembalikan');
    } finally {
      setBusy(false);
    }
  };

  const d = draft;
  const looks = FILTERS.filter((f) => d.style.filters.includes(f.id));

  return (
    <div className="op-settings">
      <nav className="op-set-nav" aria-label="Bagian pengaturan">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#set-${s.id}`}>
            {s.label}
          </a>
        ))}
        <button type="button" className="pill pill-ghost pill-sm pill-danger-text" onClick={() => setConfirmReset(true)}>
          Kembalikan ke bawaan…
        </button>
      </nav>

      <div className="op-set-body">
        {notice && <div className="notice">{notice}</div>}

        <Card id="standby" title="Layar awal" intro="Yang tampil di booth saat menunggu tamu.">
          <div className="op-set-preview" aria-hidden="true">
            <span>{d.standby.kicker || 'Nama acara'}</span>
            <b>
              {d.standby.title}
              {d.standby.accent && (
                <>
                  <br />
                  <em>{d.standby.accent}</em>
                </>
              )}
            </b>
            <i>{d.standby.button} →</i>
          </div>
          <Row label="Teks kecil di atas judul" hint="Kosongkan untuk menampilkan nama acara.">
            <input className="field" value={d.standby.kicker} maxLength={60} placeholder="Nama acara" onChange={(e) => set('standby', 'kicker', e.target.value)} />
          </Row>
          <Row label="Judul">
            <input className="field" value={d.standby.title} maxLength={60} onChange={(e) => set('standby', 'title', e.target.value)} />
          </Row>
          <Row label="Judul baris kedua" hint="Ditulis miring. Boleh kosong.">
            <input className="field" value={d.standby.accent} maxLength={60} onChange={(e) => set('standby', 'accent', e.target.value)} />
          </Row>
          <Row label="Tulisan tombol mulai">
            <input className="field" value={d.standby.button} maxLength={60} onChange={(e) => set('standby', 'button', e.target.value)} />
          </Row>
          <Row label="Info di bawah layar" hint="Harga mulai, QRIS, langsung dicetak, simpan ke HP.">
            <Switch label="Info di bawah layar" checked={d.standby.chips} onChange={(v) => set('standby', 'chips', v)} />
          </Row>
          <Row label="Buka konsol dari booth" hint="Tahan logo di layar awal selama ini.">
            <Segments
              value={d.standby.holdSeconds}
              options={CHOICES.holdSeconds.map((n) => ({ value: n, label: `${n} detik` }))}
              onChange={(v) => set('standby', 'holdSeconds', v)}
            />
          </Row>
        </Card>

        <Card id="packages" title="Paket & cetak" intro="Harga diatur per acara di Ringkasan → Pengaturan acara.">
          <Row label="Paket yang ditawarkan" hint="Minimal satu.">
            <Checks
              options={PACKAGES.map((p) => ({ id: p.id, label: `${p.label} · ${p.shots} foto` }))}
              value={d.packages.enabled}
              onChange={(v) => set('packages', 'enabled', v)}
            />
          </Row>
          <Row label="Tamu bisa tambah cetakan" hint="Tombol +1 cetak di layar paket.">
            <Switch label="Tamu bisa tambah cetakan" checked={d.packages.extraPrints} onChange={(v) => set('packages', 'extraPrints', v)} />
          </Row>
          {d.packages.extraPrints && (
            <Row label="Maksimal cetakan tambahan">
              <Select value={d.packages.maxExtra} options={[1, 2, 3, 5, 10, 20]} format={(n) => `${n} lembar`} onChange={(v) => set('packages', 'maxExtra', v)} />
            </Row>
          )}
          <Row label="Tawarkan bingkai bawaan" hint="Tema Simpel (Klasik, Malam, Terakota, Polos, Galeri). Tetap muncul kalau paket itu belum punya frame upload yang tampil.">
            <Switch label="Tawarkan bingkai bawaan" checked={d.sheet.builtin} onChange={(v) => set('sheet', 'builtin', v)} />
          </Row>
          <Row label="Tulisan di bingkai bawaan" hint="Tercetak di bawah foto pada bingkai Simpel, mis. hashtag acara. Kosong = nama acara.">
            <input className="field" value={d.sheet.text} maxLength={60} placeholder="Nama acara" onChange={(e) => set('sheet', 'text', e.target.value)} />
          </Row>
          <Row label="Tanggal di bingkai bawaan">
            <Switch label="Tanggal di bingkai bawaan" checked={d.sheet.date} onChange={(v) => set('sheet', 'date', v)} />
          </Row>
        </Card>

        <Card id="flow" title="Alur & waktu" intro="Batas waktu tiap layar. Saat habis, booth lanjut sendiri dengan pilihan yang ada.">
          <Row label="Layar paket" hint="Kembali ke layar awal kalau tidak disentuh.">
            <Select value={d.flow.idleSeconds} options={[30, 60, 90, 120, 180]} format={seconds} onChange={(v) => set('flow', 'idleSeconds', v)} />
          </Row>
          <Row label="Pilih bingkai (Hias)">
            <Select value={d.flow.hiasSeconds} options={[60, 120, 180, 300, 600]} format={seconds} onChange={(v) => set('flow', 'hiasSeconds', v)} />
          </Row>
          <Row label="Kamera live di Hias" hint="Tamu melihat dirinya di dalam bingkai. Matikan kalau perangkat lambat.">
            <Switch label="Kamera live di Hias" checked={d.flow.livePreview} onChange={(v) => set('flow', 'livePreview', v)} />
          </Row>
          <Row label="Batas bayar QRIS" hint="Lewat dari ini, kode QR diganti yang baru.">
            <Select value={d.flow.paymentMinutes} options={[5, 10, 15, 20, 30]} format={(n) => `${n} menit`} onChange={(v) => set('flow', 'paymentMinutes', v)} />
          </Row>
          <Row label="Sesi foto" hint="Saat habis, foto yang kosong diambil otomatis.">
            <Select value={d.flow.captureSeconds} options={[180, 300, 600, 900, 1200]} format={seconds} onChange={(v) => set('flow', 'captureSeconds', v)} />
          </Row>
          <Row label="Pilih gaya">
            <Select value={d.flow.gayaSeconds} options={[30, 60, 120, 180, 300]} format={seconds} onChange={(v) => set('flow', 'gayaSeconds', v)} />
          </Row>
          <Row label="Layar cetak" hint="Kembali ke layar awal setelah selesai mencetak.">
            <Select value={d.flow.shareSeconds} options={[20, 30, 45, 60, 120]} format={seconds} onChange={(v) => set('flow', 'shareSeconds', v)} />
          </Row>
        </Card>

        <Card id="capture" title="Foto & pose">
          <Row label="Suara" hint="Bip tiap detik hitung mundur dan bunyi rana. Pastikan volume perangkat booth menyala.">
            <Switch label="Suara" checked={d.capture.sound} onChange={(v) => set('capture', 'sound', v)} />
          </Row>
          <Row label="Hitung mundur tiap foto">
            <Segments value={d.flow.countdown} options={CHOICES.countdown.map((n) => ({ value: n, label: `${n} dtk` }))} onChange={(v) => set('flow', 'countdown', v)} />
          </Row>
          <Row label="Tampilkan hasil tiap foto" hint="Jeda sebelum hitung mundur berikutnya.">
            <Segments
              value={d.flow.showTenths}
              options={[8, 12, 20, 30].map((n) => ({ value: n, label: `${n / 10} dtk` }))}
              onChange={(v) => set('flow', 'showTenths', v)}
            />
          </Row>
          <Row label="Tamu boleh foto ulang" hint="Klik 2 kali pada foto untuk mengulang.">
            <Switch label="Tamu boleh foto ulang" checked={d.capture.retake} onChange={(v) => set('capture', 'retake', v)} />
          </Row>
          <Row label="Arahan pose" hint="Satu baris per foto, berulang kalau fotonya lebih banyak. Maksimal 12.">
            <textarea
              className="field op-textarea"
              rows={6}
              value={prompts}
              onChange={(e) => {
                setPrompts(e.target.value);
                set(
                  'capture',
                  'prompts',
                  e.target.value
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean),
                );
              }}
            />
          </Row>
          <Row label="Video per foto" hint="Rekam hitung mundur jadi video singkat, plus video satu lembar. Paling banyak makan tempat.">
            <Switch label="Video per foto" checked={d.capture.clips} onChange={(v) => set('capture', 'clips', v)} />
          </Row>
          {d.capture.clips && (
            <Row label="Kualitas video" hint={`Kira-kira ${clipSize(d.capture.videoQuality, d.flow.countdown)} per foto.`}>
              <Segments
                value={d.capture.videoQuality}
                options={[
                  { value: 'hemat', label: 'Hemat' },
                  { value: 'standar', label: 'Standar' },
                  { value: 'tinggi', label: 'Tinggi' },
                ]}
                onChange={(v) => set('capture', 'videoQuality', v)}
              />
            </Row>
          )}
        </Card>

        <Card id="style" title="Gaya & beauty" intro="Pilihan di layar Gaya, setelah foto. Kalau hanya Asli dan beauty mati, layar ini dilewati.">
          <Row label="Gaya warna" hint="Asli selalu ada.">
            <Checks options={FILTERS.map((f) => ({ id: f.id, label: f.label }))} value={d.style.filters} locked={['original']} onChange={(v) => set('style', 'filters', v)} />
          </Row>
          <Row label="Gaya yang terpilih dulu">
            <select className="field" value={looks.some((f) => f.id === d.style.defaultFilter) ? d.style.defaultFilter : 'original'} onChange={(e) => set('style', 'defaultFilter', e.target.value)}>
              {looks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Tawarkan mode beauty" hint="Menghaluskan dan mencerahkan kulit saja; mata, alis, dan latar tetap tajam.">
            <Switch label="Tawarkan mode beauty" checked={d.style.beauty} onChange={(v) => set('style', 'beauty', v)} />
          </Row>
          {d.style.beauty && (
            <Row label="Beauty yang terpilih dulu">
              <Segments value={d.style.defaultBeauty} options={BEAUTY.map((b) => ({ value: b.id, label: b.label }))} onChange={(v) => set('style', 'defaultBeauty', v)} />
            </Row>
          )}
        </Card>

        <Card id="share" title="Berbagi & galeri" intro="Galeri acara sendiri dinyalakan per acara di Ringkasan.">
          <Row label="QR simpan ke HP" hint="Matikan untuk acara yang hanya cetak.">
            <Switch label="QR simpan ke HP" checked={d.share.qr} onChange={(v) => set('share', 'qr', v)} />
          </Row>
          <Row label="Foto tamu masuk galeri" hint="Tanpa ditanya, foto baru tampil di galeri acara.">
            <Switch label="Foto tamu masuk galeri" checked={d.share.galleryDefault} onChange={(v) => set('share', 'galleryDefault', v)} />
          </Row>
          <Row label="Tamu bisa memilih" hint="Tombol “Tampilkan di galeri acara” di layar cetak.">
            <Switch label="Tamu bisa memilih" checked={d.share.galleryChoice} onChange={(v) => set('share', 'galleryChoice', v)} />
          </Row>
          <Row label="Video satu lembar" hint="Semua video foto diputar bersama di dalam bingkai. Butuh video per foto.">
            <Switch label="Video satu lembar" checked={d.share.liveVideo} onChange={(v) => set('share', 'liveVideo', v)} />
          </Row>
          <Row label="Pesan di halaman unduhan" hint="Tampil untuk tamu yang scan QR, mis. ucapan terima kasih atau akun Instagram. Boleh kosong.">
            <input
              className="field"
              value={d.share.message}
              maxLength={140}
              placeholder="Terima kasih sudah datang! Follow @snaplorebooth"
              onChange={(e) => set('share', 'message', e.target.value)}
            />
          </Row>
        </Card>

        <Card id="storage" title="Penyimpanan">
          <Row label="Simpan foto tamu" hint="Lewat dari ini, foto, video, dan halaman QR sesi dihapus otomatis.">
            <Select value={d.storage.photoHours} options={CHOICES.retentionHours} format={hours} onChange={(v) => set('storage', 'photoHours', v)} />
          </Row>
          <Row label="Simpan video" hint="Video makan tempat paling banyak; boleh dihapus lebih dulu. Foto tetap ada.">
            <Select
              value={Math.min(d.storage.videoHours, d.storage.photoHours)}
              options={CHOICES.retentionHours.filter((h) => h <= d.storage.photoHours)}
              format={hours}
              onChange={(v) => set('storage', 'videoHours', v)}
            />
          </Row>
          <Row
            label="Ukuran foto kamera"
            hint={
              canShrink
                ? 'Sisi terpanjang foto yang disimpan. 2400 px tetap tajam untuk cetak 4R dan HP.'
                : 'Foto Canon disimpan apa adanya di server ini (pengecil foto hanya ada di macOS). Kamera perangkat tetap mengikuti.'
            }
          >
            <Segments
              value={d.storage.maxEdge}
              options={CHOICES.maxEdge.map((n) => ({ value: n, label: n === 0 ? 'Asli' : `${n} px` }))}
              onChange={(v) => set('storage', 'maxEdge', v)}
            />
          </Row>
          <Row label="Kualitas foto (JPEG)">
            <Segments value={d.storage.quality} options={[70, 80, 85, 90, 95].map((n) => ({ value: n, label: `${n}%` }))} onChange={(v) => set('storage', 'quality', v)} />
          </Row>
          <StoragePanel initial={storage} />
        </Card>
      </div>

      <div className="op-set-bar" data-show={dirty || !!error}>
        <span className="op-set-bar-text">
          {error ? (
            <b className="op-set-error">{error}</b>
          ) : (
            <>
              <span className="op-long">Ada perubahan yang belum disimpan.</span>
              <span className="op-short">Belum disimpan</span>
            </>
          )}
        </span>
        <button type="button" className="pill pill-ghost pill-sm" onClick={() => (apply(saved), setError(null))} disabled={busy}>
          Batalkan
        </button>
        <button type="button" className="pill pill-sm" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Kembalikan semua pengaturan ke bawaan?"
          confirmLabel="Ya, kembalikan"
          busy={busy}
          error={error}
          onConfirm={() => void reset()}
          onCancel={() => setConfirmReset(false)}
        >
          <p>
            Layar awal, paket, waktu, pose, gaya, berbagi, dan penyimpanan kembali seperti semula (mis. hitung mundur{' '}
            {defaults.flow.countdown} detik, simpan foto {hours(defaults.storage.photoHours)}).
          </p>
          <p className="op-muted">Acara, harga, frame, printer, dan foto tamu tidak berubah.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
