/**
 * Backdrops the AI puts behind the guests on the Gaya screen (tab Latar), drawn here rather than
 * shipped as pictures: each is a gradient with a little texture, the same at any size and on any
 * device. The ids are stored on sessions; add one by adding an entry.
 */
export interface BoothBackground {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** The same "random" dots every time, so the preview and the print agree. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function linear(ctx: CanvasRenderingContext2D, w: number, h: number, stops: string[], angle = 90) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) * w * 0.5;
  const dy = Math.sin(rad) * h * 0.5;
  const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function bokeh(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[], count: number, seed: number) {
  const rand = seeded(seed);
  const unit = Math.max(w, h);
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = unit * (0.03 + rand() * 0.09);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const color = colors[i % colors.length];
    g.addColorStop(0, color);
    g.addColorStop(0.7, color);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export const BACKGROUNDS: BoothBackground[] = [
  {
    id: 'studio',
    label: 'Studio',
    draw(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.hypot(w, h) * 0.65);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#cfc8be');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'blush',
    label: 'Pink Pastel',
    draw(ctx, w, h) {
      linear(ctx, w, h, ['#ffd1dc', '#ffeef3', '#ffc6d6'], 70);
      bokeh(ctx, w, h, ['#ffffff', '#ffb3c7'], 18, 7);
    },
  },
  {
    id: 'sky',
    label: 'Langit',
    draw(ctx, w, h) {
      linear(ctx, w, h, ['#4fb3ff', '#a9dcff', '#e6f5ff'], 90);
      const rand = seeded(11);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (let c = 0; c < 4; c++) {
        const cx = rand() * w;
        const cy = h * (0.1 + rand() * 0.5);
        const s = Math.max(w, h) * (0.05 + rand() * 0.05);
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.ellipse(cx + (i - 2) * s * 0.8, cy + Math.sin(i * 1.7) * s * 0.25, s, s * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'sunset',
    label: 'Senja',
    draw(ctx, w, h) {
      linear(ctx, w, h, ['#ffb35c', '#ff6f7d', '#7b4fa3'], 90);
      const g = ctx.createRadialGradient(w * 0.5, h * 0.62, 0, w * 0.5, h * 0.62, Math.max(w, h) * 0.35);
      g.addColorStop(0, 'rgba(255, 236, 180, 0.9)');
      g.addColorStop(1, 'rgba(255, 236, 180, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'night',
    label: 'Lampu Kota',
    draw(ctx, w, h) {
      linear(ctx, w, h, ['#0d1330', '#2a1b4d', '#120d22'], 90);
      bokeh(ctx, w, h, ['#ffd27a', '#ff7aa8', '#7ad7ff', '#fff2c0'], 34, 23);
    },
  },
  {
    id: 'mint',
    label: 'Konfeti',
    draw(ctx, w, h) {
      linear(ctx, w, h, ['#d4fbe6', '#f3fff8'], 45);
      const rand = seeded(5);
      const colors = ['#ff5c8a', '#ffd23f', '#4cc9f0', '#a78bfa', '#7bd389', '#cc785c'];
      const unit = Math.max(w, h);
      for (let i = 0; i < 90; i++) {
        ctx.save();
        ctx.translate(rand() * w, rand() * h);
        ctx.rotate(rand() * Math.PI);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(0, 0, unit * 0.018, unit * 0.007);
        ctx.restore();
      }
    },
  },
  {
    id: 'checker',
    label: 'Retro Kotak',
    draw(ctx, w, h) {
      const cell = Math.max(w, h) / 10;
      for (let y = 0; y * cell < h; y++) {
        for (let x = 0; x * cell < w; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#f6d6de' : '#fff7ea';
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    },
  },
  {
    id: 'terracotta',
    label: 'Terakota',
    draw(ctx, w, h) {
      const g = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h * 0.35, Math.hypot(w, h) * 0.7);
      g.addColorStop(0, '#e39a7d');
      g.addColorStop(1, '#7a3f2c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
];

/** "Asli": the photo's own background. */
export const NO_BACKGROUND = 'none';

export function backgroundById(id: string | undefined): BoothBackground | null {
  return BACKGROUNDS.find((b) => b.id === id) ?? null;
}
