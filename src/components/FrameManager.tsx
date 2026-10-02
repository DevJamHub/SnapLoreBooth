'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FrameFileError, frameGuide, prepareFrame, type PreparedFrame } from '@/lib/frameDesign';
import { PACKAGES } from '@/lib/packages';
import { composeStrip } from '@/lib/strip';
import type { CustomFrame } from '@/lib/types';

const MAX_NAME = 24;

function packageLabel(format: string): string {
  return PACKAGES.find((p) => p.format === format)?.label ?? format;
}

export default function FrameManager({ frames }: { frames: CustomFrame[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedFrame | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The prepared PNG lives in an object URL until it is saved or dropped.
  useEffect(() => () => void (prepared && URL.revokeObjectURL(prepared.url)), [prepared]);

  // Shows the frame as a guest will see it: stand-in photos under the design.
  useEffect(() => {
    if (!prepared) return setPreview(null);
    let cancelled = false;
    const draft: CustomFrame = { id: 'draft', name, format: prepared.format, slots: prepared.slots, src: prepared.url, created_at: '' };
    composeStrip(
      prepared.slots.map(() => null),
      { format: prepared.format, filterId: 'original', templateId: 'draft', eventName: '', capturedAt: new Date(), frame: draft },
      0.85,
    )
      .then((url) => !cancelled && setPreview(url))
      .catch(() => !cancelled && setError('Pratinjau gagal dibuat.'));
    return () => {
      cancelled = true;
    };
    // The name does not change the picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared]);

  const reset = () => {
    setPrepared(null);
    setName('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSaved(null);
    setPrepared(null);
    setBusy('reading');
    try {
      const result = await prepareFrame(file);
      setPrepared(result);
      setName(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, MAX_NAME));
    } catch (err) {
      setError(err instanceof FrameFileError ? err.message : 'File ini tidak bisa dibaca sebagai frame.');
      if (inputRef.current) inputRef.current.value = '';
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!prepared || !name.trim()) return;
    setBusy('saving');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', prepared.blob, 'frame.png');
      form.append('name', name.trim());
      form.append('format', prepared.format);
      form.append('slots', JSON.stringify(prepared.slots));
      const res = await fetch('/api/operator/frames', { method: 'POST', body: form });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan frame');
      setSaved(`Frame "${name.trim()}" tersimpan. Tamu paket ${packageLabel(prepared.format)} sekarang bisa memilihnya.`);
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan frame');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/frames/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menghapus frame');
      setConfirmDelete(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menghapus frame');
    } finally {
      setDeleting(false);
    }
  };

  const downloadGuide = async (format: string, label: string) => {
    const blob = await frameGuide(format, label);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `panduan-frame-${label.toLowerCase().replace(/\s+/g, '-')}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const tilted = prepared?.slots.some((s) => s.angle) ?? false;

  return (
    <div className="kiosk-body">
      <section className="col-deck scroll" style={{ flex: '0 0 420px' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <span className="mono">UPLOAD FRAME</span>
          <p className="muted" style={{ fontSize: 14 }}>
            Desain 4R tegak, 1200 × 1800 px. Tandai tempat foto dengan <b>kotak hijau #00FF00</b> (bisa pakai Canva gratis) atau
            buat bagian itu <b>transparan</b>. Jumlah tempat foto menentukan paketnya: 6, 4, 3, atau 1. Foto boleh miring.
          </p>

          <input
            ref={inputRef}
            id="frame-file"
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {!prepared && (
            <label htmlFor="frame-file" className="pill" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {busy === 'reading' ? 'Membaca frame…' : 'Pilih file frame (PNG / JPG)'}
            </label>
          )}

          {prepared && (
            <>
              <div className="frame-preview">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="Pratinjau frame" />
                ) : (
                  <span className="muted">Menyusun pratinjau…</span>
                )}
                {preview &&
                  prepared.slots.map((slot, i) => (
                    <span
                      key={i}
                      className="frame-slot-num"
                      style={{
                        left: `${((slot.x + slot.w / 2) / 1200) * 100}%`,
                        top: `${((slot.y + slot.h / 2) / 1800) * 100}%`,
                      }}
                    >
                      {i + 1}
                    </span>
                  ))}
              </div>
              <div className="notice">
                Terdeteksi <b>{prepared.slots.length} tempat foto</b> → paket <b>{packageLabel(prepared.format)}</b>
                {tilted ? ' · ada foto miring' : ''} · ditandai {prepared.marking === 'green' ? 'kotak hijau' : 'bagian transparan'}.
                Angka = urutan foto.
              </div>
              <label className="field-label">
                <span className="mono mono-sm">NAMA FRAME (TERLIHAT OLEH TAMU)</span>
                <input className="field" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} />
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="pill" onClick={save} disabled={busy !== null || !name.trim() || !preview} style={{ flex: 1 }}>
                  {busy === 'saving' ? 'Menyimpan…' : 'Simpan frame'}
                </button>
                <button className="pill pill-ghost" onClick={reset} disabled={busy !== null}>
                  Batal
                </button>
              </div>
            </>
          )}

          {saved && <div className="notice">{saved}</div>}
          {error && <div className="notice notice-error">{error}</div>}
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <span className="mono">PANDUAN UKURAN</span>
          <p className="muted" style={{ fontSize: 14 }}>
            Unduh, pakai sebagai latar di Canva (ukuran khusus 1200 × 1800 px), lalu desain di sekitarnya. Kotak hijaunya boleh
            digeser, diubah ukurannya, atau dimiringkan.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {PACKAGES.map((pkg) => (
              <button key={pkg.id} className="pill pill-ghost pill-sm" onClick={() => void downloadGuide(pkg.format, pkg.label)}>
                {pkg.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Ekspor dari Canva: Bagikan → Unduh → PNG. Kotak hijau harus hijau polos #00FF00, tanpa efek, bayangan, atau
            transparansi. Jangan pakai warna hijau terang itu di bagian lain desain.
          </p>
        </div>
      </section>

      <div className="panel scroll" style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <h3>Frame tersimpan</h3>
        {frames.length === 0 ? (
          <p className="muted">Belum ada frame upload. Tamu memakai frame bawaan (Klasik, Malam, Terakota, Polos, Galeri).</p>
        ) : (
          PACKAGES.map((pkg) => {
            const list = frames.filter((f) => f.format === pkg.format);
            if (list.length === 0) return null;
            return (
              <section key={pkg.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <span className="mono">{pkg.label.toUpperCase()}</span>
                <div className="frame-grid">
                  {list.map((f) => (
                    <div key={f.id} className="frame-card">
                      <div className="frame-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.src} alt={f.name} />
                      </div>
                      <b style={{ fontSize: 15 }}>{f.name}</b>
                      <span className="mono mono-sm">
                        {new Date(f.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {confirmDelete === f.id ? (
                        <>
                          <div className="notice notice-error" style={{ fontSize: 13 }}>
                            Hapus frame ini permanen? Tamu tidak bisa memilihnya lagi. Foto yang sudah jadi tidak berubah.
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button className="pill pill-danger pill-sm" onClick={() => void remove(f.id)} disabled={deleting} style={{ flex: 1 }}>
                              {deleting ? 'Menghapus…' : 'Ya, hapus'}
                            </button>
                            <button className="pill pill-ghost pill-sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                              Batal
                            </button>
                          </div>
                        </>
                      ) : (
                        <button className="pill pill-ghost pill-sm" onClick={() => setConfirmDelete(f.id)}>
                          Hapus
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
