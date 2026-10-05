import type { BeautyLevel } from './packages';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 0 below a, 1 above b, a straight ramp between. */
const ramp = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));

/**
 * How much a colour looks like skin, 0–1: a soft box in YCbCr, wide enough for darker and
 * olive skin. Lips (redder) and hair (darker) mostly fall outside it, so they stay sharp.
 */
function skinWeight(r: number, g: number, b: number): number {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return ramp(cr, 128, 138) * (1 - ramp(cr, 172, 182)) * ramp(cb, 72, 84) * (1 - ramp(cb, 128, 138)) * ramp(y, 28, 60);
}

/** Box blur of one line of a plane, clamped at the ends, by a running sum. */
function blurLine(src: Float32Array, dst: Float32Array, start: number, stride: number, n: number, r: number) {
  const last = n - 1;
  let sum = src[start] * (r + 1);
  for (let i = 1; i <= r; i++) sum += src[start + Math.min(i, last) * stride];
  const div = 2 * r + 1;
  for (let i = 0; i < n; i++) {
    dst[start + i * stride] = sum / div;
    sum += src[start + Math.min(i + r + 1, last) * stride] - src[start + Math.max(i - r, 0) * stride];
  }
}

/** Two box passes each way: close to a Gaussian, at a cost that does not grow with the radius. */
function blur(plane: Float32Array, w: number, h: number, r: number, scratch: Float32Array) {
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) blurLine(plane, scratch, y * w, 1, w, r);
    for (let x = 0; x < w; x++) blurLine(scratch, plane, x, w, h, r);
  }
}

/**
 * Smooths and brightens skin in place, leaving edges (eyes, brows, lips, hairline) and
 * everything that is not skin alone. Each pixel moves toward its blurred neighbourhood only
 * as far as it is skin and the neighbourhood is flat: a big difference means an edge.
 */
export function applyBeauty(image: ImageData, level: BeautyLevel) {
  const { width: w, height: h, data } = image;
  const n = w * h;
  const radius = Math.max(1, Math.round(Math.min(w, h) * level.radius));

  const red = new Float32Array(n);
  const green = new Float32Array(n);
  const blue = new Float32Array(n);
  const mask = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    red[i] = data[p];
    green[i] = data[p + 1];
    blue[i] = data[p + 2];
    mask[i] = skinWeight(data[p], data[p + 1], data[p + 2]);
  }

  const scratch = new Float32Array(n);
  // The mask is blurred too: a lone skin-coloured pixel in the background barely counts,
  // and the smoothing fades in at a face's edge instead of stopping at a line.
  blur(mask, w, h, radius, scratch);
  if (level.smooth > 0) {
    blur(red, w, h, radius, scratch);
    blur(green, w, h, radius, scratch);
    blur(blue, w, h, radius, scratch);
  }

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const skin = mask[i];
    if (skin < 0.02) continue;
    let r = data[p];
    let g = data[p + 1];
    let b = data[p + 2];
    if (level.smooth > 0) {
      const diff = Math.abs(0.299 * (r - red[i]) + 0.587 * (g - green[i]) + 0.114 * (b - blue[i]));
      const t = level.smooth * skin * (1 - ramp(diff, level.edge * 0.25, level.edge));
      r += (red[i] - r) * t;
      g += (green[i] - g) * t;
      b += (blue[i] - b) * t;
    }
    const lift = level.lift * skin;
    r += (255 - r) * lift + level.warmth * skin;
    g += (255 - g) * lift;
    b += (255 - b) * lift - level.warmth * skin;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
  }
}
