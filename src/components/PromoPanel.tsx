'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { voucherLabel, type VoucherKind } from '@/lib/promo';
import { readJson } from '@/lib/readJson';
import type { Voucher } from '@/lib/vouchers';

const KINDS: { id: VoucherKind; label: string }[] = [
  { id: 'percent', label: 'Diskon %' },
  { id: 'amount', label: 'Potongan Rp' },
  { id: 'free', label: 'Gratis' },
];

function status(v: Voucher): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!v.active) return { text: 'Mati', tone: 'muted' };
  if (v.expires_at && new Date(v.expires_at).getTime() < Date.now()) return { text: 'Berakhir', tone: 'warn' };
  if (v.max_uses !== null && v.used >= v.max_uses) return { text: 'Habis', tone: 'warn' };
  return { text: 'Aktif', tone: 'ok' };
}

/**
 * Konsol → Ringkasan: promo codes guests type on the package screen. Switching one off is
 * immediate and reversible; deleting asks first (sessions keep the code on their record).
 */
export default function PromoPanel({ initial, payments }: { initial: Voucher[]; payments: boolean }) {
  const router = useRouter();
  const [vouchers, setVouchers] = useState(initial);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<VoucherKind>('percent');
  const [value, setValue] = useState('20');
  const [maxUses, setMaxUses] = useState('');
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Voucher | null>(null);

  const refresh = async () => {
    const res = await fetch('/api/operator/vouchers', { cache: 'no-store' });
    const data = await readJson<{ vouchers?: Voucher[] }>(res);
    if (data.vouchers) setVouchers(data.vouchers);
    router.refresh();
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          kind,
          value: kind === 'free' ? 0 : Number(value),
          max_uses: maxUses ? Number(maxUses) : null,
          // The end of the chosen day, booth time.
          expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
          note,
        }),
      });
      const data = await readJson<{ voucher?: Voucher }>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan');
      setCode('');
      setNote('');
      setMaxUses('');
      setExpires('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (v: Voucher) => {
    setError(null);
    const res = await fetch(`/api/operator/vouchers/${encodeURIComponent(v.code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !v.active }),
    });
    const data = await readJson<{ voucher?: Voucher }>(res);
    if (!res.ok) return setError(data.error ?? 'gagal mengubah');
    await refresh();
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/vouchers/${encodeURIComponent(deleting.code)}`, { method: 'DELETE' });
      const data = await readJson<{ deleted?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'gagal menghapus');
      setDeleting(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menghapus');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="op-card">
      <div className="op-card-head">
        <h2>Kode promo</h2>
        <span className="op-chip" data-tone={vouchers.some((v) => status(v).tone === 'ok') ? 'ok' : 'muted'}>
          {vouchers.filter((v) => status(v).tone === 'ok').length} aktif
        </span>
      </div>
      <p className="op-muted">
        Tamu mengetik kode di layar paket; harga langsung turun. {payments ? '' : 'Acara ini gratis, jadi tombol promo tidak muncul.'}
      </p>

      {vouchers.length > 0 && (
        <div className="op-list">
          {vouchers.map((v) => {
            const s = status(v);
            return (
              <div key={v.code} className="op-list-row op-promo-row">
                <div>
                  <b className="op-promo-code">{v.code}</b>
                  <span className="op-muted">
                    {voucherLabel(v)} · dipakai {v.used}
                    {v.max_uses !== null ? `/${v.max_uses}` : ''}
                    {v.expires_at ? ` · s.d. ${new Date(v.expires_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}` : ''}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                </div>
                <div className="op-row">
                  <span className="op-chip" data-tone={s.tone}>
                    {s.text}
                  </span>
                  <button className="pill pill-ghost pill-sm" onClick={() => void toggle(v)}>
                    {v.active ? 'Matikan' : 'Nyalakan'}
                  </button>
                  <button className="pill pill-ghost pill-sm pill-danger-text" onClick={() => setDeleting(v)}>
                    Hapus
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="op-field">
        <span className="op-label">Kode baru</span>
        <input
          className="field"
          value={code}
          placeholder="mis. WEDDING20"
          maxLength={20}
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
      </div>
      <div className="op-field">
        <span className="op-label">Jenis</span>
        <div className="segmented">
          {KINDS.map((k) => (
            <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {kind !== 'free' && (
        <label className="op-field">
          <span className="op-label">{kind === 'percent' ? 'Diskon (%)' : 'Potongan (Rp)'}</span>
          <input className="field" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      <div className="op-row">
        <label className="op-field" style={{ flex: '1 1 140px' }}>
          <span className="op-label">Kuota (kosong = bebas)</span>
          <input className="field" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="op-field" style={{ flex: '1 1 160px' }}>
          <span className="op-label">Berlaku s.d. (boleh kosong)</span>
          <input className="field" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </div>
      <label className="op-field">
        <span className="op-label">Catatan (untuk operator)</span>
        <input className="field" value={note} maxLength={60} placeholder="mis. kode influencer @nama" onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="op-muted" style={{ fontSize: 13 }}>
        Harga setelah diskon tidak pernah di bawah Rp1.500 (batas QRIS), kecuali promo Gratis.
      </p>
      {error && <div className="notice notice-error">{error}</div>}
      <button className="pill" onClick={create} disabled={busy || code.length < 3}>
        {busy ? 'Menyimpan…' : 'Buat kode promo'}
      </button>

      {deleting && (
        <ConfirmDialog
          title={`Hapus kode ${deleting.code}?`}
          confirmLabel="Hapus kode"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        >
          <p>
            Tamu tidak bisa memakainya lagi. Sesi yang sudah memakai kode ini ({deleting.used}) tetap tercatat dengan diskonnya. Kalau
            hanya ingin menghentikan sementara, pakai <b>Matikan</b>.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
