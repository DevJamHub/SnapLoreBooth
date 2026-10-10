import { expect, test, type Page } from '@playwright/test';

const OPERATOR = { Authorization: `Basic ${Buffer.from('operator:e2e').toString('base64')}` };

/** Drags from one point to another in small steps, as a finger would. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('a guest uses a promo, pays, picks, decorates, prints, buys one more, takes it home and deletes it', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Out of the box a guest shoots exactly the sheet's holes, and only the operator erases photos.
  const plain = (await (await page.request.post('/api/sessions', { data: { packageId: 'three' } })).json()).session;
  expect(plain).toMatchObject({ shots: 3, bonus: 0 });
  const defaults = (await (await page.request.get('/api/operator/settings', { headers: OPERATOR })).json()).config;
  expect(defaults.capture).toMatchObject({ voice: false, bonus: 0 });
  expect(defaults.share).toMatchObject({ erase: false, galleryChoice: false });

  // This booth offers two bonus shots to pick from, and lets guests erase their own photos.
  const offered = await page.request.patch('/api/operator/settings', { headers: OPERATOR, data: { capture: { bonus: 2 }, share: { erase: true } } });
  expect(offered.ok()).toBe(true);

  // The operator makes a half-price code.
  const promo = await page.request.post('/api/operator/vouchers', {
    headers: OPERATOR,
    data: { code: 'HEMAT50', kind: 'percent', value: 50 },
  });
  expect(promo.ok()).toBe(true);

  await page.goto('/');
  // The start button breathes, so it is never "stable" to Playwright.
  await page.getByRole('button', { name: /Sentuh untuk mulai/ }).click({ force: true });
  await expect(page).toHaveURL(/\/paket/);
  await page.locator('.pkg-card', { hasText: 'Empat foto besar' }).click();
  await page.getByRole('button', { name: 'Kode promo' }).click();
  await page.locator('.pkg-code').fill('salah');
  await page.getByRole('button', { name: 'Pakai' }).click();
  await expect(page.getByText('Kode promo tidak dikenal.')).toBeVisible();
  await page.locator('.pkg-code').fill('hemat50');
  await page.getByRole('button', { name: 'Pakai' }).click();
  await expect(page.locator('.g-bar-value').first()).toContainText('Rp12.500');
  await page.getByRole('button', { name: /Pilih frame/ }).click();

  await expect(page).toHaveURL(/\/hias\//);
  await page.getByRole('button', { name: /Lanjut bayar/ }).click();

  await expect(page).toHaveURL(/\/pay\//);
  await expect(page.locator('.pay-amount')).toHaveText('Rp12.500');
  await expect(page.getByText(/promo HEMAT50/)).toBeVisible();
  await page.getByRole('button', { name: 'Simulasi bayar' }).click();

  await expect(page).toHaveURL(/\/capture\//);
  await page.getByRole('button', { name: /Mulai foto/ }).click();

  // Four for the sheet and two bonus shots; the guest swaps the second for the fifth.
  const pickGaya = page.getByRole('button', { name: /Pilih gaya/ });
  await expect(pickGaya).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.pick-photo')).toHaveCount(6);
  await page.getByRole('button', { name: 'Foto 2, di tempat 2' }).click();
  await expect(pickGaya).toBeDisabled();
  await page.getByRole('button', { name: 'Foto 5', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Foto 5, di tempat 4' })).toBeVisible();
  await pickGaya.click();

  await expect(page).toHaveURL(/\/gaya\//);
  await page.getByRole('button', { name: 'Film', exact: true }).click();

  // The AI backdrop runs on the device; the fake camera has no people, so it is all backdrop.
  await page.getByRole('tab', { name: 'Latar AI' }).click();
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await expect(page.locator('.st-hint')).toHaveText('Tahan untuk lihat aslinya', { timeout: 60_000 });

  await page.getByRole('tab', { name: 'Stiker' }).click();
  await page.getByRole('button', { name: 'Mahkota' }).click();
  await page.getByRole('button', { name: 'Bestie' }).click();
  await expect(page.locator('[data-decor="piece"]')).toHaveCount(2);

  const sheet = (await page.locator('.dc-svg').boundingBox())!;
  const piece = (await page.locator('[data-decor="piece"]').last().boundingBox())!;
  await drag(page, { x: piece.x + piece.width / 2, y: piece.y + piece.height / 2 }, { x: sheet.x + sheet.width * 0.4, y: sheet.y + sheet.height * 0.2 });

  await page.getByRole('tab', { name: 'Tulisan' }).click();
  await page.locator('.dc-input').fill('Bestie forever');
  await page.getByRole('button', { name: 'Tempel' }).click();
  await expect(page.locator('[data-decor="piece"]')).toHaveCount(3);

  await page.getByRole('tab', { name: 'Gambar' }).click();
  await drag(page, { x: sheet.x + sheet.width * 0.2, y: sheet.y + sheet.height * 0.7 }, { x: sheet.x + sheet.width * 0.8, y: sheet.y + sheet.height * 0.75 });
  await expect(page.locator('.dc-svg path')).not.toHaveCount(0);

  // Undo takes the stroke back; drawing again puts one there.
  await page.getByRole('button', { name: 'Urungkan' }).click();
  await drag(page, { x: sheet.x + sheet.width * 0.2, y: sheet.y + sheet.height * 0.6 }, { x: sheet.x + sheet.width * 0.8, y: sheet.y + sheet.height * 0.65 });

  await page.getByRole('button', { name: /Cetak sekarang/ }).click();
  await expect(page).toHaveURL(/\/share\//, { timeout: 60_000 });
  const id = page.url().split('/').pop()!;
  await expect(page.getByText('Video live siap')).toBeVisible({ timeout: 60_000 });

  // One more sheet, paid by QRIS after printing.
  await expect(page.getByText('Mau cetak lagi?')).toBeVisible({ timeout: 30_000 });
  await page.locator('.sh-more-pay').click();
  await page.getByRole('dialog', { name: 'Bayar cetak lagi' }).getByRole('button', { name: 'Simulasi bayar' }).click();
  await expect(page.getByText('Mencetak 1 dari 1 lembar')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Ambil cetakanmu')).toBeVisible({ timeout: 15_000 });

  // The session kept the decorations, so the QR page and reprints match the paper.
  const saved = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(saved.session.format).toBe('grid4');
  expect(saved.session.price_idr).toBe(12_500);
  expect(saved.session.voucher).toBe('HEMAT50');
  expect(saved.session.prints).toBe(2);
  expect(saved.session.picks).toEqual([1, 3, 4, 5]);
  expect(saved.photos).toHaveLength(6);
  expect(saved.session.filter).toBe('film');
  expect(saved.session.background).toBe('studio');
  expect(saved.session.decor.map((d: { kind: string }) => d.kind)).toEqual(['sticker', 'sticker', 'text', 'ink']);

  // The guest's phone.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  p.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await p.goto(`/d/${id}`);
  await expect(p.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', new RegExp(`wa\\.me/\\?text=.*${id}`));
  await p.getByRole('button', { name: 'Jadikan GIF' }).click();
  await expect(p.getByRole('link', { name: 'Download GIF' })).toBeVisible({ timeout: 60_000 });
  await p.getByRole('button', { name: 'Boomerang' }).first().click();
  await expect(p.getByRole('link', { name: 'Download boomerang' })).toBeVisible({ timeout: 60_000 });
  await p.getByRole('button', { name: 'Versi Story' }).click();
  await expect(p.getByRole('dialog', { name: 'Versi story' })).toBeVisible();
  await p.getByRole('button', { name: 'Tutup' }).click();

  // A contact only with consent.
  await p.getByRole('button', { name: /Mau dapat promo/ }).click();
  await p.getByPlaceholder('Nama').fill('Rina Putri');
  await p.getByPlaceholder(/Nomor WhatsApp/).fill('0812-3456-7890');
  await p.getByRole('button', { name: 'Instagram', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Kirim' })).toBeDisabled();
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: 'Kirim' }).click();
  await expect(p.getByText('Terima kasih, Rina!')).toBeVisible();
  const csv = await (await page.request.get('/api/operator/export?kind=contacts', { headers: OPERATOR })).text();
  expect(csv).toContain("Rina Putri,'081234567890,,Instagram");

  // Konsol → Data shows the session's rows with the photos themselves.
  const desk = await browser.newContext({ httpCredentials: { username: 'operator', password: 'e2e' } });
  const op = await desk.newPage();
  op.on('pageerror', (e) => errors.push(`data: ${e.message}`));
  await op.goto(`/operator/data?t=photos&q=${id}`);
  await expect(op.locator('.op-db-grid tbody tr')).toHaveCount(6);
  const thumb = op.locator('.op-db-thumb img').first();
  await expect(thumb).toHaveAttribute('src', `/api/media/${id}/shot-6.jpeg`);
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await op.getByRole('link', { name: id, exact: true }).first().click();
  await expect(op).toHaveURL(new RegExp(`t=sessions&q=${id}`));
  await expect(op.locator('.op-db-grid tbody tr')).toHaveCount(1);
  await expect(op.locator(`.op-db-thumb img[src="/api/media/${id}/strip.jpeg"]`)).toBeVisible();
  // Only the database's own tables can be asked for.
  await op.goto('/operator/data?t=sqlite_master');
  await expect(op.getByRole('heading', { name: 'sessions' })).toBeVisible();
  await desk.close();

  // The next guest sees this one's sheet on standby.
  await page.goto('/');
  await expect(page.locator('.polaroid-sheet')).toHaveCount(1);

  // The guest deletes their photos; the payment stays on record.
  await p.getByRole('button', { name: 'Hapus fotoku dari server' }).click();
  await p.getByRole('button', { name: 'Ya, hapus' }).click();
  await expect(p.getByRole('heading', { name: 'Fotomu sudah dihapus' })).toBeVisible();
  await phone.close();
  const erased = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(erased.session.strip_file).toBeNull();
  expect(erased.photos).toHaveLength(0);
  const report = await (await page.request.get('/api/operator/export?kind=csv&r=today', { headers: OPERATOR })).text();
  expect(report).toContain(`${id},`);
  await page.reload();
  await expect(page.locator('.polaroid-sheet')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('a tourist switches the booth to English, and the next guest gets Indonesian again', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start in English' }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'How many poses?' })).toBeVisible();
  await expect(page.getByText('Single Portrait')).toBeVisible();
  await page.getByRole('button', { name: 'ID', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mau berapa pose?' })).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByText('Bayar pakai QRIS')).toBeVisible();
  await page.getByRole('button', { name: /Sentuh untuk mulai/ }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Mau berapa pose?' })).toBeVisible();
});
