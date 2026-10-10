import { CHOICES, DEFAULT_PROMPTS, VIDEO_BITRATES, type BoothConfig } from './configShared';
import { getSetting, setSetting } from './db';
import { BEAUTY, FILTERS, LOOKS_ADDED_V2, MAX_EXTRA_PRINTS, PACKAGES } from './packages';

export { CHOICES, DEFAULT_PROMPTS, VIDEO_BITRATES } from './configShared';
export type { BoothConfig, VideoQuality } from './configShared';

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export function defaultConfig(): BoothConfig {
  const retention = envNumber('RETENTION_HOURS', 168);
  return {
    standby: { kicker: '', title: 'Senyum dulu,', accent: 'yuk!', button: 'Sentuh untuk mulai', chips: true, holdSeconds: 3, showcase: true, fullscreen: true, english: true },
    packages: { enabled: PACKAGES.map((p) => p.id), extraPrints: true, maxExtra: MAX_EXTRA_PRINTS },
    flow: {
      idleSeconds: 60,
      hiasSeconds: 300,
      livePreview: true,
      paymentMinutes: envNumber('PAYMENT_QR_TTL_MINUTES', 10),
      captureSeconds: 600,
      countdown: 3,
      showTenths: 12,
      // Long enough to add stickers and a few words, not only to pick a look.
      gayaSeconds: 180,
      shareSeconds: 45,
    },
    sheet: { text: '', date: true, builtin: true, qr: true },
    // No spoken prompts and no bonus shots unless the operator turns them on: a guest shoots
    // exactly as many photos as the sheet has holes, and hears only beeps.
    capture: { sound: true, voice: false, retake: true, bonus: 0, prompts: DEFAULT_PROMPTS, clips: true, videoQuality: 'standar' },
    style: { filters: FILTERS.map((f) => f.id), defaultFilter: 'original', beauty: true, defaultBeauty: 'off', decor: true, backgrounds: true },
    // Guests neither erase their photos nor take them out of the gallery themselves; the
    // operator does both from the session log, unless these are switched back on.
    share: {
      qr: true,
      galleryChoice: false,
      galleryDefault: true,
      liveVideo: true,
      message: '',
      upsell: true,
      contacts: true,
      question: 'Tahu booth ini dari mana?',
      answers: ['Lewat di sini', 'Instagram', 'TikTok', 'Teman', 'Lainnya'],
      erase: false,
    },
    // Videos take most of the disk and guests download the same day: they go after 3 days.
    storage: { photoHours: retention, videoHours: Math.min(72, retention), maxEdge: 2400, quality: 85 },
  };
}

const KEY = 'booth.config';
const MAX_TEXT = 60;
const MAX_PROMPTS = 12;
const MAX_ANSWERS = 8;

export class ConfigInputError extends Error {}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Readers for one field: the stored value when valid, else the fallback (lenient), or an error (strict). */
function reader(strict: boolean) {
  const fail = (field: string, why: string) => {
    if (strict) throw new ConfigInputError(`${field}: ${why}`);
  };
  return {
    text(value: unknown, fallback: string, field: string, allowEmpty = true, max = MAX_TEXT): string {
      if (value === undefined) return fallback;
      if (typeof value !== 'string') return fail(field, 'harus teks'), fallback;
      const text = value.replace(/\s+/g, ' ').trim().slice(0, max);
      if (!text && !allowEmpty) return fail(field, 'tidak boleh kosong'), fallback;
      return text;
    },
    bool(value: unknown, fallback: boolean, field: string): boolean {
      if (value === undefined) return fallback;
      if (typeof value !== 'boolean') return fail(field, 'harus ya/tidak'), fallback;
      return value;
    },
    int(value: unknown, fallback: number, field: string, min: number, max: number): number {
      if (value === undefined) return fallback;
      const n = Number(value);
      if (!Number.isInteger(n) || n < min || n > max) return fail(field, `harus bilangan ${min}–${max}`), fallback;
      return n;
    },
    oneOf<T>(value: unknown, fallback: T, field: string, options: readonly T[]): T {
      if (value === undefined) return fallback;
      if (!options.includes(value as T)) return fail(field, 'pilihan tidak dikenal'), fallback;
      return value as T;
    },
    subset(value: unknown, fallback: string[], field: string, options: string[], required: string[] = []): string[] {
      if (value === undefined) return fallback;
      if (!Array.isArray(value)) return fail(field, 'pilihan tidak dikenal'), fallback;
      // The operator may only tick what is offered; a stored list may name something since retired
      // (a package taken off the catalogue), which is dropped rather than resetting the whole list.
      if (strict && value.some((v) => !options.includes(v as string))) return fail(field, 'pilihan tidak dikenal'), fallback;
      // Kept in the catalogue's order, whatever order they were ticked in.
      const chosen = options.filter((o) => value.includes(o) || required.includes(o));
      if (chosen.length === 0) return fail(field, 'pilih minimal satu'), fallback;
      return chosen;
    },
    lines(value: unknown, fallback: string[], field: string, max = MAX_PROMPTS): string[] {
      if (value === undefined) return fallback;
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return fail(field, 'harus daftar teks'), fallback;
      const lines = (value as string[]).map((v) => v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)).filter(Boolean).slice(0, max);
      if (lines.length === 0) return fail(field, 'isi minimal satu baris'), fallback;
      return lines;
    },
  };
}

/** Reads `input` over `base`, section by section. Strict mode rejects instead of falling back. */
function merge(base: BoothConfig, input: unknown, strict: boolean): BoothConfig {
  const r = reader(strict);
  const src = isObject(input) ? input : {};
  const section = (name: keyof BoothConfig): Raw => (isObject(src[name]) ? (src[name] as Raw) : {});
  const s = section('standby');
  const p = section('packages');
  const f = section('flow');
  const sh0 = section('sheet');
  const c = section('capture');
  const st = section('style');
  const sh = section('share');
  const sg = section('storage');

  const filters = r.subset(st.filters, base.style.filters, 'Gaya warna', FILTERS.map((x) => x.id), ['original']);
  const photoHours = r.oneOf(sg.photoHours, base.storage.photoHours, 'Simpan foto', [...CHOICES.retentionHours, base.storage.photoHours]);
  const videoHours = r.oneOf(sg.videoHours, base.storage.videoHours, 'Simpan video', [...CHOICES.retentionHours, base.storage.videoHours]);

  const config: BoothConfig = {
    standby: {
      kicker: r.text(s.kicker, base.standby.kicker, 'Teks kecil'),
      title: r.text(s.title, base.standby.title, 'Judul', false),
      accent: r.text(s.accent, base.standby.accent, 'Judul baris kedua'),
      button: r.text(s.button, base.standby.button, 'Tombol mulai', false),
      chips: r.bool(s.chips, base.standby.chips, 'Info bawah'),
      holdSeconds: r.oneOf(s.holdSeconds, base.standby.holdSeconds, 'Tahan logo', CHOICES.holdSeconds),
      showcase: r.bool(s.showcase, base.standby.showcase, 'Foto tamu di layar awal'),
      fullscreen: r.bool(s.fullscreen, base.standby.fullscreen, 'Layar penuh'),
      english: r.bool(s.english, base.standby.english, 'Bahasa Inggris'),
    },
    packages: {
      enabled: r.subset(p.enabled, base.packages.enabled, 'Paket', PACKAGES.map((x) => x.id)),
      extraPrints: r.bool(p.extraPrints, base.packages.extraPrints, 'Cetak tambahan'),
      maxExtra: r.int(p.maxExtra, base.packages.maxExtra, 'Maksimal cetak tambahan', 1, MAX_EXTRA_PRINTS),
    },
    flow: {
      idleSeconds: r.int(f.idleSeconds, base.flow.idleSeconds, 'Layar paket', 20, 300),
      hiasSeconds: r.int(f.hiasSeconds, base.flow.hiasSeconds, 'Waktu Hias', 30, 900),
      livePreview: r.bool(f.livePreview, base.flow.livePreview, 'Kamera di Hias'),
      paymentMinutes: r.int(f.paymentMinutes, base.flow.paymentMinutes, 'Batas QRIS', 2, 30),
      captureSeconds: r.int(f.captureSeconds, base.flow.captureSeconds, 'Waktu foto', 60, 1800),
      countdown: r.oneOf(f.countdown, base.flow.countdown, 'Hitung mundur', CHOICES.countdown),
      showTenths: r.int(f.showTenths, base.flow.showTenths, 'Tampil hasil', 5, 50),
      gayaSeconds: r.int(f.gayaSeconds, base.flow.gayaSeconds, 'Waktu Gaya', 20, 600),
      shareSeconds: r.int(f.shareSeconds, base.flow.shareSeconds, 'Layar cetak', 15, 300),
    },
    sheet: {
      text: r.text(sh0.text, base.sheet.text, 'Tulisan di bingkai'),
      date: r.bool(sh0.date, base.sheet.date, 'Tanggal di bingkai'),
      builtin: r.bool(sh0.builtin, base.sheet.builtin, 'Bingkai bawaan'),
      qr: r.bool(sh0.qr, base.sheet.qr, 'QR di cetakan'),
    },
    capture: {
      sound: r.bool(c.sound, base.capture.sound, 'Suara'),
      voice: r.bool(c.voice, base.capture.voice, 'Suara pemandu'),
      retake: r.bool(c.retake, base.capture.retake, 'Foto ulang'),
      bonus: r.oneOf(c.bonus, base.capture.bonus, 'Foto bonus', CHOICES.bonus),
      prompts: r.lines(c.prompts, base.capture.prompts, 'Arahan pose'),
      clips: r.bool(c.clips, base.capture.clips, 'Video per foto'),
      videoQuality: r.oneOf(c.videoQuality, base.capture.videoQuality, 'Kualitas video', CHOICES.videoQuality),
    },
    style: {
      filters,
      defaultFilter: r.oneOf(st.defaultFilter, base.style.defaultFilter, 'Gaya awal', FILTERS.map((x) => x.id)),
      beauty: r.bool(st.beauty, base.style.beauty, 'Mode beauty'),
      defaultBeauty: r.oneOf(st.defaultBeauty, base.style.defaultBeauty, 'Beauty awal', BEAUTY.map((x) => x.id)),
      decor: r.bool(st.decor, base.style.decor, 'Stiker & coretan'),
      backgrounds: r.bool(st.backgrounds, base.style.backgrounds, 'Latar AI'),
    },
    share: {
      qr: r.bool(sh.qr, base.share.qr, 'QR'),
      galleryChoice: r.bool(sh.galleryChoice, base.share.galleryChoice, 'Pilihan galeri'),
      galleryDefault: r.bool(sh.galleryDefault, base.share.galleryDefault, 'Galeri otomatis'),
      liveVideo: r.bool(sh.liveVideo, base.share.liveVideo, 'Video sheet'),
      message: r.text(sh.message, base.share.message, 'Pesan di halaman unduhan', true, 140),
      upsell: r.bool(sh.upsell, base.share.upsell, 'Cetak lagi'),
      contacts: r.bool(sh.contacts, base.share.contacts, 'Kontak tamu'),
      question: r.text(sh.question, base.share.question, 'Pertanyaan', true, 80),
      answers: r.lines(sh.answers, base.share.answers, 'Pilihan jawaban', MAX_ANSWERS),
      erase: r.bool(sh.erase, base.share.erase, 'Tamu bisa menghapus fotonya'),
    },
    storage: {
      photoHours,
      videoHours,
      maxEdge: r.oneOf(sg.maxEdge, base.storage.maxEdge, 'Ukuran foto', CHOICES.maxEdge),
      quality: r.int(sg.quality, base.storage.quality, 'Kualitas foto', 60, 95),
    },
  };

  // A default that is not offered falls back to the plain look.
  if (!config.style.filters.includes(config.style.defaultFilter)) config.style.defaultFilter = 'original';
  if (!config.style.beauty) config.style.defaultBeauty = 'off';
  // Videos never outlive the photos they belong to.
  if (config.storage.videoHours > config.storage.photoHours) config.storage.videoHours = config.storage.photoHours;
  return config;
}

const CATALOGUE_V2 = 'migration.catalogue_v2';

/**
 * A booth saved before the new looks existed lists only the old ones, so guests would never see
 * them. Offered once; an operator who switches them off keeps them off.
 */
function offerNewCatalogue(parsed: unknown): unknown {
  if (getSetting(CATALOGUE_V2)) return parsed;
  if (isObject(parsed)) {
    const style = parsed.style;
    if (isObject(style) && Array.isArray(style.filters)) {
      style.filters = [...style.filters, ...LOOKS_ADDED_V2.filter((id) => !(style.filters as unknown[]).includes(id))];
    }
    setSetting(KEY, JSON.stringify(parsed));
  }
  setSetting(CATALOGUE_V2, '1');
  return parsed;
}

const GUEST_EXTRAS_OFF = 'migration.guest_extras_off';

/**
 * The guiding voice, bonus shots, and guests erasing their photos or leaving the gallery all
 * used to be on, and a booth saved back then stored them on. Switched off once; an operator who
 * turns one back on afterwards keeps it.
 */
function switchOffGuestExtras(parsed: unknown): unknown {
  if (getSetting(GUEST_EXTRAS_OFF)) return parsed;
  if (isObject(parsed)) {
    if (isObject(parsed.capture)) Object.assign(parsed.capture, { voice: false, bonus: 0 });
    if (isObject(parsed.share)) Object.assign(parsed.share, { erase: false, galleryChoice: false });
    setSetting(KEY, JSON.stringify(parsed));
  }
  setSetting(GUEST_EXTRAS_OFF, '1');
  return parsed;
}

export function getConfig(): BoothConfig {
  const stored = getSetting(KEY);
  let parsed: unknown = null;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    // A damaged document reads as the defaults; the next save replaces it.
  }
  return merge(defaultConfig(), switchOffGuestExtras(offerNewCatalogue(parsed)), false);
}

/** Applies the operator's changes (any subset of sections and fields); invalid input is refused. */
export function updateConfig(patch: unknown): BoothConfig {
  if (!isObject(patch)) throw new ConfigInputError('pengaturan harus berupa objek');
  const next = merge(getConfig(), patch, true);
  setSetting(KEY, JSON.stringify(next));
  return next;
}

export function resetConfig(): BoothConfig {
  setSetting(KEY, null);
  return getConfig();
}

/** The live clip and the whole-sheet video bitrates for the chosen quality. */
export function videoBitrates(config: BoothConfig = getConfig()) {
  return VIDEO_BITRATES[config.capture.videoQuality];
}

/** What a built-in frame prints under the photos: the operator's text, else the event name. */
export function sheetText(eventName: string, config: BoothConfig = getConfig()): string {
  return config.sheet.text || eventName;
}
