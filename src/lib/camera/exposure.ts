import type { CameraChoices, CameraSettings } from './types';

/** Average brightness (0–255) a good booth photo lands in: faces neither dark nor blown. */
export const BRIGHTNESS = { low: 95, target: 128, high: 175 };
/** Guard rails the automatic setup and corrections keep to. */
export const SHUTTER = { slowest: 1 / 60, fastest: 1 / 250, preferred: '1/125' };
export const APERTURE = { widest: 3.5, narrowest: 11, preferred: 5.6 };
const ISO_MAX = 3200;

/** "1/125" → 0.008; "0.5" or "1" → seconds. */
export function shutterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const fraction = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const seconds = Number.parseFloat(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function fNumber(value: string | null | undefined): number | null {
  const n = Number.parseFloat((value ?? '').replace(/^f\//i, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const isoNumber = (value: string | null | undefined): number | null => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The choice whose value is nearest `want` on a log scale (stops), within [min, max]. */
function nearest(choices: string[], parse: (v: string) => number | null, want: number, min: number, max: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const choice of choices) {
    const value = parse(choice);
    if (value === null || value < min - 1e-9 || value > max + 1e-9) continue;
    const distance = Math.abs(Math.log2(value / want));
    if (distance < bestDistance) {
      best = choice;
      bestDistance = distance;
    }
  }
  return best;
}

/** The shutter speed and aperture a booth should not go past, nearest to where they are. */
export function guardRails(settings: CameraSettings, choices: CameraChoices, mode: string | null): Partial<CameraSettings> {
  const patch: Partial<CameraSettings> = {};
  const manual = /^manual$/i.test(mode ?? '');
  const shutter = shutterSeconds(settings.shutterspeed);
  if ((manual || /^tv$/i.test(mode ?? '')) && shutter !== null && (shutter > SHUTTER.slowest + 1e-9 || shutter < SHUTTER.fastest - 1e-9)) {
    const pick = choices.shutterspeed.includes(SHUTTER.preferred)
      ? SHUTTER.preferred
      : nearest(choices.shutterspeed, shutterSeconds, 1 / 125, SHUTTER.fastest, SHUTTER.slowest);
    if (pick && pick !== settings.shutterspeed) patch.shutterspeed = pick;
  }
  const f = fNumber(settings.aperture);
  if ((manual || /^av$/i.test(mode ?? '')) && f !== null && (f < APERTURE.widest || f > APERTURE.narrowest)) {
    const pick = nearest(choices.aperture, fNumber, APERTURE.preferred, APERTURE.widest, APERTURE.narrowest);
    if (pick && pick !== settings.aperture) patch.aperture = pick;
  }
  return patch;
}

/**
 * How to change the exposure after a test shot came out `mean` bright: ISO first when it is
 * fixed, then shutter within 1/250–1/60, then aperture within f/3.5–f/11. Null when the shot is
 * already in range, or nothing more can move. 8-bit brightness follows exposure roughly by a
 * 1/2.2 power, so the stops needed are 2.2 × log2(target/mean).
 */
export function exposureCorrection(
  settings: CameraSettings,
  choices: CameraChoices,
  mode: string | null,
  mean: number,
): { patch: Partial<CameraSettings>; stops: number } | null {
  if (mean >= BRIGHTNESS.low && mean <= BRIGHTNESS.high) return null;
  let stops = Math.max(-3, Math.min(3, 2.2 * Math.log2(BRIGHTNESS.target / Math.max(mean, 4))));
  const wanted = stops;
  const patch: Partial<CameraSettings> = {};
  const manual = /^manual$/i.test(mode ?? '');

  const iso = isoNumber(settings.iso);
  if (iso !== null && !/auto/i.test(settings.iso ?? '')) {
    const pick = nearest(choices.iso, isoNumber, iso * 2 ** stops, 100, ISO_MAX);
    const picked = isoNumber(pick);
    if (pick && picked && pick !== settings.iso) {
      patch.iso = pick;
      stops -= Math.log2(picked / iso);
    }
  }

  const shutter = shutterSeconds(settings.shutterspeed);
  if (Math.abs(stops) > 0.4 && shutter !== null && (manual || /^tv$/i.test(mode ?? ''))) {
    const pick = nearest(choices.shutterspeed, shutterSeconds, shutter * 2 ** stops, SHUTTER.fastest, SHUTTER.slowest);
    const picked = shutterSeconds(pick);
    if (pick && picked && pick !== settings.shutterspeed) {
      patch.shutterspeed = pick;
      stops -= Math.log2(picked / shutter);
    }
  }

  const f = fNumber(settings.aperture);
  if (Math.abs(stops) > 0.4 && f !== null && (manual || /^av$/i.test(mode ?? ''))) {
    // Light through the lens goes with 1/f²: one stop is a factor of √2 in f.
    const pick = nearest(choices.aperture, fNumber, f / 2 ** (stops / 2), APERTURE.widest, APERTURE.narrowest);
    const picked = fNumber(pick);
    if (pick && picked && pick !== settings.aperture) {
      patch.aperture = pick;
      stops -= 2 * Math.log2(f / picked);
    }
  }

  return Object.keys(patch).length > 0 ? { patch, stops: wanted } : null;
}
