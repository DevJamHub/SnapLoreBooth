import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { BACKGROUNDS } from '../../src/lib/backgrounds';
import { DEFAULT_PROMPTS } from '../../src/lib/configShared';
import { DECOR_FONTS, STICKERS } from '../../src/lib/decor';
import { EN } from '../../src/lib/i18n-en';
import { BEAUTY, BUILTIN_THEME, EXTRA_PRINT, FILTERS, PACKAGES, TEMPLATES, UNSORTED_THEME } from '../../src/lib/packages';

const GUEST_FILES = [
  'components/Standby.tsx',
  'components/guest/GuestHeader.tsx',
  'components/PackagePicker.tsx',
  'components/FrameStage.tsx',
  'components/PaymentStage.tsx',
  'components/CaptureStage.tsx',
  'components/StyleStage.tsx',
  'components/ShareStage.tsx',
  'components/ExtraPrintDialog.tsx',
  'components/ShareTools.tsx',
  'components/ClipCard.tsx',
  'components/LivePanel.tsx',
  'components/GuestPrivacy.tsx',
  'app/d/[id]/page.tsx',
];

/** Quoted strings inside each `t(…)` call's first argument; words only (not ids compared inside it). */
function translatedLiterals(source: string): string[] {
  const found: string[] = [];
  const call = /\bt\(/g;
  for (let m = call.exec(source); m; m = call.exec(source)) {
    let depth = 1;
    let i = m.index + 2;
    let firstArgEnd = -1;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 1 && firstArgEnd < 0) firstArgEnd = i;
    }
    const arg = source.slice(m.index + 2, firstArgEnd > 0 ? firstArgEnd : i - 1);
    for (const q of arg.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      // Strings compared with === (state names) are not shown to anyone.
      if (/[=!]==\s*$/.test(arg.slice(Math.max(0, (q.index ?? 0) - 6), q.index))) continue;
      if (/[A-Za-z]/.test(q[1])) found.push(q[1]);
    }
  }
  return found;
}

test('every guest string shown through t() has English', () => {
  const missing = new Set<string>();
  for (const file of GUEST_FILES) {
    const source = fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
    for (const text of translatedLiterals(source)) if (!(text in EN)) missing.add(`${file}: ${text}`);
  }
  expect([...missing]).toEqual([]);
});

test('every catalogue label a guest sees has English', () => {
  const labels = [
    ...PACKAGES.flatMap((p) => [p.label, p.blurb]),
    EXTRA_PRINT.label,
    ...FILTERS.map((f) => f.label),
    ...BEAUTY.flatMap((b) => [b.label, b.blurb]),
    ...BACKGROUNDS.map((b) => b.label),
    ...STICKERS.map((s) => s.label),
    ...DECOR_FONTS.map((f) => f.label),
    ...TEMPLATES.map((t) => t.label),
    BUILTIN_THEME,
    UNSORTED_THEME,
    ...DEFAULT_PROMPTS,
    'Pilih', 'Hias', 'Bayar', 'Foto', 'Gaya', 'Cetak',
    'Warna', 'Latar AI', 'Stiker', 'Tulisan', 'Gambar', 'Tipis', 'Sedang', 'Tebal',
  ];
  expect(labels.filter((l) => !(l in EN))).toEqual([]);
});
