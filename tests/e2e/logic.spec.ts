import { expect, test } from '@playwright/test';
import { DecorInputError, parseDecor } from '../../src/lib/decor';
import { QRIS_MIN_IDR, discounted } from '../../src/lib/promo';

const SHEET = { width: 1200, height: 1800 };

test('promo codes take off what they say, never leaving less than QRIS takes', () => {
  expect(discounted(40_000, { kind: 'percent', value: 20 })).toEqual({ total: 32_000, discount: 8_000 });
  expect(discounted(25_000, { kind: 'amount', value: 10_000 })).toEqual({ total: 15_000, discount: 10_000 });
  expect(discounted(25_000, { kind: 'amount', value: 24_000 }).total).toBe(QRIS_MIN_IDR);
  expect(discounted(25_000, { kind: 'amount', value: 90_000 }).total).toBe(0);
  expect(discounted(25_000, { kind: 'free', value: 0 })).toEqual({ total: 0, discount: 25_000 });
});

test('decorations are checked before they are kept', () => {
  const ok = parseDecor(
    [
      { kind: 'sticker', sticker: 'heart', x: 600, y: 900, size: 200, angle: 12 },
      { kind: 'text', text: '  Bestie   forever ', font: 'hand', color: '#ffffff', x: 100, y: 100, size: 120, angle: 0 },
      { kind: 'ink', color: '#ff5c8a', width: 16, points: [10, 10, 20, 20, 30, 25] },
    ],
    SHEET,
  );
  expect(ok).toHaveLength(3);
  expect(ok[1]).toMatchObject({ text: 'Bestie forever' });

  const refused = [
    [{ kind: 'sticker', sticker: 'not-a-sticker', x: 1, y: 1, size: 100, angle: 0 }],
    [{ kind: 'text', text: '', font: 'hand', color: '#ffffff', x: 1, y: 1, size: 100, angle: 0 }],
    [{ kind: 'text', text: 'hi', font: 'comic', color: '#ffffff', x: 1, y: 1, size: 100, angle: 0 }],
    [{ kind: 'ink', color: '#123456', width: 10, points: [1, 1] }],
    [{ kind: 'ink', color: '#ffffff', width: 10, points: [1, 1, 2] }],
    [{ kind: 'sticker', sticker: 'heart', x: 99999, y: 1, size: 100, angle: 0 }],
    Array.from({ length: 61 }, () => ({ kind: 'sticker', sticker: 'heart', x: 1, y: 1, size: 100, angle: 0 })),
  ];
  for (const input of refused) expect(() => parseDecor(input, SHEET)).toThrow(DecorInputError);
  expect(parseDecor(null, SHEET)).toEqual([]);
});
