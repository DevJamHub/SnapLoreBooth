import type { ImageSegmenter } from '@mediapipe/tasks-vision';

/**
 * Finds the people in a photo, on the device, with MediaPipe's selfie segmenter (a 250 KB model
 * in public/models, its runtime served by /api/vision). Loaded the first time a guest opens the
 * Latar tab, and only then; photos are read at a reduced size, so a budget tablet copes.
 */
const INPUT_EDGE = 640;

let segmenter: Promise<ImageSegmenter> | null = null;

export function loadSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('/api/vision');
    const make = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    // The GPU is quicker where WebGL works; some tablets' does not.
    return make('GPU').catch(() => make('CPU'));
  })();
  segmenter.catch(() => (segmenter = null));
  return segmenter;
}

/** Masks already made, by photo: a guest trying backdrops never waits twice for the same photo. */
const masks = new Map<string, Promise<HTMLCanvasElement>>();
const MASKS_KEPT = 12;

/**
 * Where the people are in `img`: a canvas of the photo's shape whose alpha is 255 on people and
 * 0 on the background, with soft edges.
 */
export function personMask(src: string, img: HTMLImageElement | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  let mask = masks.get(src);
  if (mask) return mask;
  mask = (async () => {
    const seg = await loadSegmenter();
    const scale = Math.min(1, INPUT_EDGE / Math.max(img.width, img.height));
    const input = document.createElement('canvas');
    input.width = Math.round(img.width * scale);
    input.height = Math.round(img.height * scale);
    input.getContext('2d')!.drawImage(img, 0, 0, input.width, input.height);

    const result = seg.segment(input);
    try {
      const confidence = result.confidenceMasks ?? [];
      // One category (person) for the selfie model; background then person for others.
      const person = confidence[confidence.length - 1];
      if (!person) throw new Error('no mask');
      const values = person.getAsFloat32Array();
      const out = document.createElement('canvas');
      out.width = person.width;
      out.height = person.height;
      const ctx = out.getContext('2d')!;
      const pixels = ctx.createImageData(out.width, out.height);
      for (let i = 0; i < values.length; i++) {
        // Sharpen the edge a little: unsure pixels lean towards the side they are nearer.
        const a = Math.min(Math.max((values[i] - 0.3) / 0.4, 0), 1);
        pixels.data[i * 4 + 3] = Math.round(a * 255);
      }
      ctx.putImageData(pixels, 0, 0);
      // The mask may come back at the model's own size; stretch it back over the photo's shape.
      const fitted = document.createElement('canvas');
      fitted.width = input.width;
      fitted.height = input.height;
      const fctx = fitted.getContext('2d')!;
      if ('filter' in fctx) fctx.filter = 'blur(1px)';
      fctx.drawImage(out, 0, 0, fitted.width, fitted.height);
      return fitted;
    } finally {
      result.close();
    }
  })();
  mask.catch(() => masks.get(src) === mask && masks.delete(src));
  masks.set(src, mask);
  if (masks.size > MASKS_KEPT) masks.delete(masks.keys().next().value!);
  return mask;
}
