'use client';

import { useState } from 'react';
import { shutterLagKey } from '@/components/guest/deviceKeys';
import { exposureCorrection, shutterSeconds } from '@/lib/camera/exposure';
import type { AutoSetupStep, CameraInfo, CameraSettings, CameraStatus } from '@/lib/camera/types';
import { mediaUrl } from '@/lib/format';
import { readEvents } from '@/lib/readEvents';
import { readJson } from '@/lib/readJson';

type Level = 'ok' | 'warn' | 'bad';

interface Check {
  title: string;
  level: Level;
  detail: string;
}

export interface TestShot {
  /** Milliseconds from asking to the shutter firing, as this device sees it. */
  lagMs: number;
  file: string;
  src: string;
}

type ShotEvent = { type: 'fired'; ms: number } | { type: 'done'; file: string; ms: number } | { type: 'error'; error: string; ms: number };

/**
 * Fires a diagnostic shot and times it from this device, the way the booth screen will time
 * a guest's shot. `requireFocus` fires only if autofocus locks.
 */
export async function fireTestShot(requireFocus = false): Promise<TestShot> {
  const started = performance.now();
  const res = await fetch(`/api/camera/test${requireFocus ? '?focus=1' : ''}`, { method: 'POST' });
  if (!res.ok || !res.body) {
    const data = await readJson<object>(res);
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  let lagMs: number | null = null;
  for await (const event of readEvents<ShotEvent>(res.body)) {
    if (event.type === 'fired') lagMs = performance.now() - started;
    else if (event.type === 'error') throw new Error(event.error);
    else if (event.type === 'done') {
      return {
        lagMs: lagMs ?? performance.now() - started,
        file: event.file,
        src: mediaUrl(event.file, String(Date.now())),
      };
    }
  }
  throw new Error('the camera did not hand over a photo');
}

/** Average brightness (0–255) and how much of the frame is crushed black or blown white. */
async function measureExposure(src: string): Promise<{ mean: number; dark: number; bright: number }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = Math.max(1, Math.round((160 * img.naturalHeight) / img.naturalWidth));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let dark = 0;
  let bright = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y;
    if (y < 16) dark++;
    if (y > 245) bright++;
  }
  return { mean: sum / pixels, dark: dark / pixels, bright: bright / pixels };
}

const seconds = (ms: number) => (ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** Turns what was read and measured into a checklist with what to change. */
function judge(
  status: CameraStatus,
  exposure: { mean: number; dark: number; bright: number } | null,
  lagMs: number | null,
  focused: boolean | null,
  /** The automatic calibration already moved ISO, shutter or aperture as far as it safely could. */
  corrected = false,
): Check[] {
  const checks: Check[] = [{ title: 'Terhubung', level: 'ok', detail: status.model ?? 'Kamera eksternal' }];

  const battery = Number.parseInt(status.battery ?? '', 10);
  if (Number.isFinite(battery)) {
    checks.push({
      title: `Baterai ${battery}%`,
      level: battery >= 50 ? 'ok' : battery >= 25 ? 'warn' : 'bad',
      detail: battery >= 50 ? 'Cukup. Untuk acara panjang tetap pakai adaptor listrik (DC coupler DR-E12).' : 'Isi daya atau pasang adaptor listrik sebelum acara.',
    });
  }

  const mode = status.mode ?? '';
  const manual = /^manual$/i.test(mode);
  checks.push(
    manual
      ? { title: 'Mode M (manual)', level: 'ok', detail: 'Terang foto sama untuk semua tamu.' }
      : /^(av|tv|p)$/i.test(mode)
        ? { title: `Mode ${mode}`, level: 'warn', detail: 'Kamera mengatur terang sendiri, foto bisa beda-beda antar tamu. Putar kenop ke M.' }
        : { title: `Mode ${mode || 'tidak terbaca'}`, level: 'bad', detail: 'Putar kenop mode kamera ke M.' },
  );

  const off = status.autoPowerOff;
  const never = off !== null && (/^0+$/.test(off.trim()) || /disable|off|never/i.test(off));
  checks.push(
    never
      ? { title: 'Mati otomatis: nonaktif', level: 'ok', detail: 'Kamera tetap menyala sepanjang acara.' }
      : off === null
        ? { title: 'Mati otomatis: tidak terbaca', level: 'warn', detail: 'Pastikan di menu kamera: Hemat daya → Mati otomatis → Nonaktif.' }
        : {
            title: `Mati otomatis setelah ${off} detik`,
            level: 'bad',
            detail: 'Kamera akan mati sendiri dan booth kehilangan kamera. Menu kamera: Hemat daya → Mati otomatis → Nonaktif.',
          },
  );

  checks.push(
    status.aspect === '3:2' || status.aspect === null
      ? { title: 'Rasio foto 3:2', level: 'ok', detail: 'Seluruh sensor terpakai.' }
      : {
          title: `Rasio foto ${status.aspect}`,
          level: 'warn',
          detail: 'Preview sudah menyesuaikan, tapi 3:2 memberi bidang gambar paling luas. Menu kamera: Rasio foto → 3:2.',
        },
  );

  const shutter = shutterSeconds(status.shutterspeed);
  if (manual && shutter !== null) {
    checks.push(
      shutter <= 1 / 60
        ? { title: `Rana ${status.shutterspeed}`, level: 'ok', detail: 'Cukup cepat untuk tamu yang bergerak.' }
        : { title: `Rana ${status.shutterspeed}`, level: 'warn', detail: 'Lebih lambat dari 1/60: gerakan tamu bisa blur. Pakai 1/100–1/125 dan tambah lampu atau ISO.' },
    );
  }

  if (exposure) {
    const mean = Math.round(exposure.mean);
    const tooDark = exposure.mean < 85;
    const tooBright = exposure.mean > 185 || exposure.bright > 0.08;
    checks.push(
      tooDark
        ? {
            title: `Foto terlalu gelap (${mean}/255)`,
            level: exposure.mean < 60 ? 'bad' : 'warn',
            detail: corrected
              ? 'ISO, rana, dan bukaan sudah disetel otomatis sampai batas aman. Tambah lampu di depan tamu, lalu kalibrasi lagi.'
              : 'Tambah lampu di depan tamu, naikkan ISO, atau buka bukaan (angka f lebih kecil). Rana jangan lebih lambat dari 1/60.',
          }
        : tooBright
          ? {
              title: `Foto terlalu terang (${mean}/255)`,
              level: 'warn',
              detail: corrected
                ? 'Sudah disetel otomatis sampai batas aman. Kurangi atau jauhkan lampu, lalu kalibrasi lagi.'
                : 'Turunkan ISO, perkecil bukaan (angka f lebih besar), atau percepat rana.',
            }
          : { title: `Terang foto pas (${mean}/255)`, level: 'ok', detail: 'Wajah tidak gelap dan tidak silau.' },
    );
  }

  if (focused !== null) {
    checks.push(
      focused
        ? { title: 'Autofokus mengunci', level: 'ok', detail: 'Di posisi dan cahaya ini kamera bisa fokus sendiri.' }
        : {
            title: 'Autofokus tidak mengunci',
            level: 'warn',
            detail: 'Booth tetap memotret, tapi bisa kurang tajam. Tambah lampu, atau pakai Kunci fokus di bawah.',
          },
    );
  }

  if (lagMs !== null) {
    checks.push(
      lagMs <= 1000
        ? { title: `Jeda rana ${seconds(lagMs)} detik`, level: 'ok', detail: 'Flash di layar jatuh tepat di angka 0.' }
        : {
            title: `Jeda rana ${seconds(lagMs)} detik`,
            level: 'warn',
            detail: `Tamu melihat "Tahan!" sekitar ${seconds(lagMs - 1000)} detik setelah angka 0. Kunci fokus dan lampu mempercepatnya.`,
          },
    );
  }

  return checks;
}

const STEPS = ['Menyetel kamera', 'Membaca pengaturan kamera', 'Menyesuaikan terang foto', 'Mengukur jeda rana', 'Uji autofokus'];
/** Test shots spent bringing the brightness into range before settling for what is there. */
const MAX_EXPOSURE_SHOTS = 3;

/** What the automatic calibration changed, in the operator's words. */
interface Change {
  label: string;
  from: string | null;
  to: string | null;
  note?: string;
  result: AutoSetupStep['result'];
}

const SETTING_LABEL: Record<keyof CameraSettings, string> = { iso: 'ISO', aperture: 'Bukaan', shutterspeed: 'Kecepatan rana' };

/**
 * Gets the external camera ready before an event. *Kalibrasi otomatis* first sets the body up
 * over USB (JPEG, single shot, one-shot AF, no sleep, 3:2, shutter and aperture in range), then
 * takes test shots and corrects ISO, shutter and aperture until the brightness is right, times
 * the shutter and tests autofocus. *Cek saja* measures without changing anything. Either way
 * the checklist says what is left to change on the body, and the measured lag is stored on this
 * device so the countdown's flash lands on zero from the first guest.
 */
export default function CameraCalibration() {
  const [step, setStep] = useState<number | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (auto: boolean) => {
    setError(null);
    setChecks(null);
    setChanges(null);
    setPreview(null);
    const made: Change[] = [];
    try {
      if (auto) {
        setStep(0);
        const res = await fetch('/api/camera/calibrate', { method: 'POST' });
        const data = await readJson<{ steps?: AutoSetupStep[] }>(res);
        if (!res.ok || !data.steps) throw new Error(data.error ?? 'kamera tidak bisa disetel');
        for (const s of data.steps) {
          if (s.result !== 'ok' && s.result !== 'missing') made.push({ label: s.label, from: s.before, to: s.after, note: s.note, result: s.result });
        }
        setChanges([...made]);
      }

      setStep(1);
      const res = await fetch('/api/camera/status', { cache: 'no-store' });
      const data = await readJson<{ status?: CameraStatus }>(res);
      if (!res.ok || !data.status) throw new Error(data.error ?? 'pengaturan kamera tidak terbaca');
      let status = data.status;
      const info = await fetch('/api/camera', { cache: 'no-store' }).then((r) => readJson<Partial<CameraInfo>>(r));

      setStep(2);
      let shot = await fireTestShot();
      setPreview(shot.src);
      let exposure = await measureExposure(shot.src).catch(() => null);
      const lags = [shot.lagMs];
      for (let i = 1; auto && exposure && info?.choices && i < MAX_EXPOSURE_SHOTS; i++) {
        const settings: CameraSettings = { iso: status.iso, aperture: status.aperture, shutterspeed: status.shutterspeed };
        const fix = exposureCorrection(settings, info.choices, status.mode, exposure.mean);
        if (!fix) break;
        const applied = await fetch('/api/camera/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fix.patch),
        }).then((r) => readJson<{ settings?: CameraSettings }>(r));
        if (!applied.settings) break;
        for (const key of Object.keys(fix.patch) as (keyof CameraSettings)[]) {
          made.push({ label: SETTING_LABEL[key], from: settings[key], to: applied.settings[key], result: 'changed', note: fix.stops > 0 ? 'foto terlalu gelap' : 'foto terlalu terang' });
        }
        setChanges([...made]);
        status = { ...status, ...applied.settings };
        shot = await fireTestShot();
        setPreview(shot.src);
        lags.push(shot.lagMs);
        exposure = await measureExposure(shot.src).catch(() => null);
      }

      setStep(3);
      // The first shot after a restart or a settings change is slow (the body is found and asked
      // how it fires); with three or more, the fastest two are the honest ones.
      do lags.push((await fireTestShot()).lagMs);
      while (lags.length < 3);
      const fastest = [...lags].sort((a, b) => a - b).slice(0, 2);
      const lagMs = fastest.reduce((a, b) => a + b, 0) / fastest.length;
      try {
        // The booth screen on this device starts from this instead of guessing.
        localStorage.setItem(shutterLagKey(info.focusLocked), String(Math.round(lagMs)));
      } catch {
        // Private mode: the countdown learns it from the first guests instead.
      }

      // A locked focus is not tested: the test autofocuses, and would move it.
      let focused: boolean | null = null;
      if (!info.focusLocked) {
        setStep(4);
        focused = await fireTestShot(true).then(
          () => true,
          (err: unknown) => {
            if (err instanceof Error && /focus/i.test(err.message)) return false;
            throw err;
          },
        );
      }

      setChecks(judge(status, exposure, lagMs, focused, made.some((c) => c.note === 'foto terlalu gelap' || c.note === 'foto terlalu terang')));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kalibrasi gagal');
    } finally {
      setStep(null);
    }
  };

  const problems = checks?.filter((c) => c.level !== 'ok').length ?? 0;

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <span className="mono">KALIBRASI KAMERA EKSTERNAL</span>
      <p className="muted" style={{ fontSize: 13 }}>
        Arahkan kamera ke titik berdiri tamu (ada orang atau benda di sana), nyalakan lampu acara, lalu mulai. Kalibrasi
        otomatis menyetel kamera lewat USB dan memotret 3–5 kali, sekitar 30 detik.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button className="pill" onClick={() => void run(true)} disabled={step !== null} style={{ flex: 1 }}>
          {step !== null ? `${step + 1}/${STEPS.length} · ${STEPS[step]}…` : checks ? 'Kalibrasi otomatis lagi' : 'Kalibrasi otomatis'}
        </button>
        <button className="pill pill-ghost" onClick={() => void run(false)} disabled={step !== null} title="Ukur tanpa mengubah pengaturan kamera">
          Cek saja
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {changes && changes.length > 0 && (
        <ul className="calib-list">
          {changes.map((c, i) => (
            <li key={`${c.label}-${i}`} data-level={c.result === 'changed' ? 'ok' : 'warn'}>
              <b>
                {c.result === 'changed' ? `${c.label}: ${c.from ?? '?'} → ${c.to ?? '?'}` : `${c.label}: ${c.from ?? 'tidak terbaca'}`}
              </b>
              <span>{c.result === 'changed' ? `Disetel otomatis${c.note ? ` (${c.note})` : ''}.` : (c.note ?? 'Tidak bisa disetel lewat USB.')}</span>
            </li>
          ))}
        </ul>
      )}
      {changes && changes.length === 0 && <div className="notice">Pengaturan kamera sudah sesuai; tidak ada yang diubah.</div>}

      {checks && (
        <>
          <div className={`notice${problems > 0 ? ' notice-error' : ''}`}>
            {problems === 0 ? 'Semua beres. Canon siap untuk acara.' : `${problems} hal perlu diubah. Ubah di kamera, lalu kalibrasi ulang.`}
          </div>
          <ul className="calib-list">
            {checks.map((check) => (
              <li key={check.title} data-level={check.level}>
                <b>{check.title}</b>
                <span>{check.detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Test shot kalibrasi" style={{ width: '100%', borderRadius: 12 }} />
      )}
    </div>
  );
}
