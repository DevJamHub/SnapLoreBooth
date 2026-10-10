'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { DECOR_LIMITS, decorTile, type DecorItem, type InkDecor, type StickerDecor, type TextDecor } from '@/lib/decor';

/** Data URLs of the tiles the sheet draws, so the screen shows exactly what prints. */
const tileUrls = new WeakMap<HTMLCanvasElement, string>();

function tileUrl(item: StickerDecor | TextDecor, eventName: string): { url: string; aspect: number } | null {
  const tile = decorTile(item, eventName);
  if (!tile) return null;
  let url = tileUrls.get(tile);
  if (!url) {
    url = tile.toDataURL('image/png');
    tileUrls.set(tile, url);
  }
  return { url, aspect: tile.width / tile.height };
}

/** The same curve drawInk() strokes on the sheet: through the midpoints of the samples. */
function inkPath(p: number[]): string {
  if (p.length === 2) return `M ${p[0]} ${p[1]} L ${p[0] + 0.01} ${p[1]}`;
  let d = `M ${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) d += ` Q ${p[i]} ${p[i + 1]} ${(p[i] + p[i + 2]) / 2} ${(p[i + 1] + p[i + 3]) / 2}`;
  return `${d} L ${p[p.length - 2]} ${p[p.length - 1]}`;
}

export function inkPointCount(items: DecorItem[]): number {
  return items.reduce((n, item) => n + (item.kind === 'ink' ? item.points.length / 2 : 0), 0);
}

/** A point further than this (in sheet pixels) from the last one is kept; closer ones add nothing. */
const INK_STEP = 4;
/** Handles keep this size on screen, whatever the sheet's scale. */
const HANDLE_PX = 22;

type Gesture =
  | { kind: 'move'; index: number; startX: number; startY: number; itemX: number; itemY: number }
  | { kind: 'turn'; pointerId: number; index: number; dist: number; angle: number; size: number; itemAngle: number }
  | { kind: 'pinch'; index: number; dist: number; angle: number; size: number; itemAngle: number }
  | { kind: 'ink'; pointerId: number; points: number[] };

/**
 * The guest's stickers, writing and doodles over the sheet preview, in the sheet's own pixels.
 * Drag to move; the corner handle or two fingers turn and resize; the cross removes. With a pen
 * chosen, a finger draws instead. Gestures report each change; `onGestureStart` comes first,
 * so the screen can keep one undo step per gesture rather than one per pixel.
 */
export default function DecorEditor({
  width,
  height,
  items,
  eventName,
  interactive,
  pen,
  selected,
  onSelect,
  onChange,
  onGestureStart,
  onFull,
}: {
  width: number;
  height: number;
  items: DecorItem[];
  eventName: string;
  /** Off on the colour tab: the decorations show but do not take touches. */
  interactive: boolean;
  /** Drawing with this colour and width; null moves stickers instead. */
  pen: { color: string; width: number } | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onChange: (items: DecorItem[]) => void;
  onGestureStart: () => void;
  /** A stroke would go past what the sheet can hold. */
  onFull: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [stroke, setStroke] = useState<number[] | null>(null);
  // Sheet pixels per screen pixel, so handles and outlines stay finger-sized.
  const [unit, setUnit] = useState(2);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0) setUnit(width / rect.width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [width]);

  const toSheet = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * width, y: ((e.clientY - rect.top) / rect.height) * height };
  };

  const replace = (index: number, patch: Partial<Pick<StickerDecor, 'x' | 'y' | 'size' | 'angle'>>) => {
    onChange(itemsRef.current.map((item, i) => (i === index && item.kind !== 'ink' ? ({ ...item, ...patch } as DecorItem) : item)));
  };

  const pinchOf = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    e.preventDefault();
    const point = toSheet(e);
    pointers.current.set(e.pointerId, point);
    svgRef.current?.setPointerCapture(e.pointerId);

    if (pen) {
      if (pointers.current.size > 1) return;
      gesture.current = { kind: 'ink', pointerId: e.pointerId, points: [Math.round(point.x), Math.round(point.y)] };
      setStroke(gesture.current.points);
      return;
    }

    // A second finger on the selected piece turns and resizes it.
    const current = gesture.current;
    if (pointers.current.size === 2 && current && current.kind === 'move') {
      const item = itemsRef.current[current.index];
      if (item && item.kind !== 'ink') {
        gesture.current = { kind: 'pinch', index: current.index, ...pinchOf(), size: item.size, itemAngle: item.angle };
      }
      return;
    }
    if (pointers.current.size > 1) return;

    const target = (e.target as Element).closest('[data-decor]');
    const role = target?.getAttribute('data-decor');
    const index = Number(target?.getAttribute('data-index'));
    if (role === 'delete' && Number.isInteger(index)) {
      onGestureStart();
      onChange(itemsRef.current.filter((_, i) => i !== index));
      onSelect(null);
      return;
    }
    if (role === 'turn' && Number.isInteger(index)) {
      const item = itemsRef.current[index];
      if (!item || item.kind === 'ink') return;
      onGestureStart();
      gesture.current = {
        kind: 'turn',
        pointerId: e.pointerId,
        index,
        dist: Math.max(Math.hypot(point.x - item.x, point.y - item.y), 1),
        angle: Math.atan2(point.y - item.y, point.x - item.x),
        size: item.size,
        itemAngle: item.angle,
      };
      return;
    }
    if (role === 'piece' && Number.isInteger(index)) {
      const item = itemsRef.current[index];
      if (!item || item.kind === 'ink') return;
      onGestureStart();
      onSelect(index);
      gesture.current = { kind: 'move', index, startX: point.x, startY: point.y, itemX: item.x, itemY: item.y };
      return;
    }
    onSelect(null);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const point = toSheet(e);
    pointers.current.set(e.pointerId, point);
    const g = gesture.current;
    if (!g) return;
    // A stray second finger neither draws nor turns; only the one that started does.
    if ((g.kind === 'ink' || g.kind === 'turn') && e.pointerId !== g.pointerId) return;

    if (g.kind === 'ink') {
      const n = g.points.length;
      if (Math.hypot(point.x - g.points[n - 2], point.y - g.points[n - 1]) < INK_STEP) return;
      if (n / 2 >= DECOR_LIMITS.strokePoints) return;
      g.points = [...g.points, Math.round(point.x), Math.round(point.y)];
      setStroke(g.points);
      return;
    }
    if (g.kind === 'move') {
      replace(g.index, { x: Math.round(g.itemX + point.x - g.startX), y: Math.round(g.itemY + point.y - g.startY) });
      return;
    }
    const item = itemsRef.current[g.index];
    if (!item || item.kind === 'ink') return;
    const now =
      g.kind === 'pinch'
        ? pinchOf()
        : { dist: Math.hypot(point.x - item.x, point.y - item.y), angle: Math.atan2(point.y - item.y, point.x - item.x) };
    const size = Math.min(Math.max((g.size * now.dist) / g.dist, 40), Math.max(width, height));
    const angle = g.itemAngle + ((now.angle - g.angle) * 180) / Math.PI;
    replace(g.index, { size: Math.round(size), angle: Math.round(((angle % 360) + 540) % 360) - 180 });
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'ink') {
      if (e.pointerId !== g.pointerId) return;
      gesture.current = null;
      setStroke(null);
      const list = itemsRef.current;
      if (list.length >= DECOR_LIMITS.items || inkPointCount(list) + g.points.length / 2 > DECOR_LIMITS.inkPoints) {
        onFull();
        return;
      }
      onGestureStart();
      onChange([...list, { kind: 'ink', color: pen?.color ?? '#ffffff', width: pen?.width ?? 16, points: g.points } satisfies InkDecor]);
      return;
    }
    // Lifting one of two fingers goes back to moving with the one left.
    if (g && g.kind === 'pinch' && pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      const item = itemsRef.current[g.index];
      if (item && item.kind !== 'ink') {
        gesture.current = { kind: 'move', index: g.index, startX: rest.x, startY: rest.y, itemX: item.x, itemY: item.y };
        return;
      }
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  const chosen = selected !== null ? items[selected] : null;
  const handle = HANDLE_PX * unit;

  return (
    <svg
      ref={svgRef}
      className="dc-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      data-live={interactive}
      data-pen={!!pen}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.kind === 'ink') {
          return (
            <path
              key={i}
              d={inkPath(item.points)}
              fill="none"
              stroke={item.color}
              strokeWidth={item.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        }
        const tile = tileUrl(item, eventName);
        if (!tile) return null;
        const h = item.size;
        const w = h * tile.aspect;
        return (
          <g key={i} transform={`translate(${item.x} ${item.y}) rotate(${item.angle})`} data-decor="piece" data-index={i}>
            <image href={tile.url} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" />
          </g>
        );
      })}

      {stroke && pen && (
        <path d={inkPath(stroke)} fill="none" stroke={pen.color} strokeWidth={pen.width} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {interactive && !pen && chosen && chosen.kind !== 'ink' && (() => {
        const tile = tileUrl(chosen, eventName);
        const h = chosen.size;
        const w = h * (tile?.aspect ?? 1);
        const pad = 6 * unit;
        return (
          <g transform={`translate(${chosen.x} ${chosen.y}) rotate(${chosen.angle})`}>
            <rect
              x={-w / 2 - pad}
              y={-h / 2 - pad}
              width={w + pad * 2}
              height={h + pad * 2}
              fill="none"
              stroke="#ffffff"
              strokeWidth={2 * unit}
              strokeDasharray={`${8 * unit} ${6 * unit}`}
              pointerEvents="none"
            />
            <g data-decor="delete" data-index={selected} transform={`translate(${-w / 2 - pad} ${-h / 2 - pad})`}>
              <circle r={handle} fill="#d9705f" stroke="#ffffff" strokeWidth={2 * unit} />
              <path
                d={`M ${-handle * 0.4} ${-handle * 0.4} L ${handle * 0.4} ${handle * 0.4} M ${handle * 0.4} ${-handle * 0.4} L ${-handle * 0.4} ${handle * 0.4}`}
                stroke="#ffffff"
                strokeWidth={3 * unit}
                strokeLinecap="round"
              />
            </g>
            <g data-decor="turn" data-index={selected} transform={`translate(${w / 2 + pad} ${h / 2 + pad})`}>
              <circle r={handle} fill="#cc785c" stroke="#ffffff" strokeWidth={2 * unit} />
              <path
                d={`M ${-handle * 0.35} ${handle * 0.1} A ${handle * 0.4} ${handle * 0.4} 0 1 1 ${handle * 0.1} ${handle * 0.38}`}
                fill="none"
                stroke="#ffffff"
                strokeWidth={3 * unit}
                strokeLinecap="round"
              />
            </g>
          </g>
        );
      })()}
    </svg>
  );
}
