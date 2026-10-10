'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { FrameFileError, frameGuide, prepareFrame, type PreparedFrame } from '@/lib/frameDesign';
import { PACKAGES, UNSORTED_THEME } from '@/lib/packages';
import { sheetSize } from '@/lib/layout';
import { composeStrip } from '@/lib/strip';
import type { CustomFrame } from '@/lib/types';

const MAX_NAME = 24;
const MAX_THEME = 20;

function packageLabel(format: string): string {
  return PACKAGES.find((p) => p.format === format)?.label ?? format;
}

/** Themes in use, in the order they first appeared (frames come oldest first). */
function themesOf(frames: CustomFrame[]): string[] {
  return [...new Set(frames.map((f) => f.theme).filter(Boolean))];
}

function ThemeChips({ themes, value, onPick }: { themes: string[]; value: string; onPick: (theme: string) => void }) {
  if (themes.length === 0) return null;
  return (
    <div className="frame-theme-chips">
      {themes.map((t) => (
        <button key={t} type="button" className="pill pill-ghost pill-sm" aria-pressed={value.toLowerCase() === t.toLowerCase()} onClick={() => onPick(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

export default function FrameManager({ frames }: { frames: CustomFrame[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const themes = themesOf(frames);
  const [prepared, setPrepared] = useState<PreparedFrame | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  // Kept between uploads: a theme's frames usually come one after another.
  const [theme, setTheme] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; theme: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [themeAction, setThemeAction] = useState<{ theme: string; hide: boolean } | null>(null);
  const deleteTarget = frames.find((f) => f.id === confirmDelete) ?? null;

  // The prepared PNG lives in an object URL until it is saved or dropped.
  useEffect(() => () => void (prepared && URL.revokeObjectURL(prepared.url)), [prepared]);

  // Shows the frame as a guest will see it: stand-in photos under the design.
  useEffect(() => {
    if (!prepared) return setPreview(null);
    let cancelled = false;
    const draft: CustomFrame = { id: 'draft', name, theme: '', hidden: false, format: prepared.format, slots: prepared.slots, src: prepared.url, created_at: '' };
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
      form.append('theme', theme.trim());
      form.append('format', prepared.format);
      form.append('slots', JSON.stringify(prepared.slots));
      const res = await fetch('/api/operator/frames', { method: 'POST', body: form });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan frame');
      setSaved(
        `Frame "${name.trim()}" tersimpan di tema ${theme.trim() || UNSORTED_THEME}. Tamu paket ${packageLabel(prepared.format)} sekarang bisa memilihnya.`,
      );
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan frame');
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/operator/frames/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editing.name.trim(), theme: editing.theme.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menyimpan perubahan');
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal menyimpan perubahan');
    } finally {
      setSavingEdit(false);
    }
  };

  /** Shows or hides frames for guests; the frames themselves stay. */
  const setHidden = async (ids: string[], hidden: boolean) => {
    setToggling(true);
    setError(null);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/operator/frames/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hidden }),
          }),
        ),
      );
      if (results.some((r) => !r.ok)) throw new Error('sebagian frame gagal diubah');
      setThemeAction(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal mengubah frame');
    } finally {
      setToggling(false);
    }
  };

  const remove = async (id: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/operator/frames/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'gagal menghapus frame');
      setConfirmDelete(null);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'gagal menghapus frame');
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
      <section className="col-deck frame-side">
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
              <div className="frame-preview" style={{ aspectRatio: `${sheetSize(prepared.format).width} / ${sheetSize(prepared.format).height}` }}>
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
                        left: `${((slot.x + slot.w / 2) / sheetSize(prepared.format).width) * 100}%`,
                        top: `${((slot.y + slot.h / 2) / sheetSize(prepared.format).height) * 100}%`,
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
              <label className="field-label">
                <span className="mono mono-sm">TEMA (MIS. BIOSKOP, ROMANCE)</span>
                <input
                  className="field"
                  list="frame-themes"
                  value={theme}
                  maxLength={MAX_THEME}
                  placeholder={`Kosong = ${UNSORTED_THEME}`}
                  onChange={(e) => setTheme(e.target.value)}
                />
              </label>
              <ThemeChips themes={themes} value={theme} onPick={setTheme} />
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
        <datalist id="frame-themes">
          {themes.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {frames.length === 0 ? (
          <p className="muted">Belum ada frame upload. Tamu memakai frame bawaan (tema Simpel: Klasik, Malam, Terakota, Polos, Galeri).</p>
        ) : (
          [...themes, ''].map((group) => {
            const list = frames.filter((f) => f.theme === group);
            if (list.length === 0) return null;
            const shown = list.filter((f) => !f.hidden).length;
            return (
              <section key={group || '-'} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div className="frame-theme-head">
                  <span className="mono">
                    {(group || UNSORTED_THEME).toUpperCase()} · {list.length} FRAME{shown < list.length ? ` · ${list.length - shown} DISEMBUNYIKAN` : ''}
                  </span>
                  <button
                    className="pill pill-ghost pill-sm"
                    onClick={() => setThemeAction({ theme: group, hide: shown > 0 })}
                    disabled={toggling}
                  >
                    {shown > 0 ? 'Sembunyikan tema' : 'Tampilkan tema'}
                  </button>
                </div>
                <div className="frame-grid">
                  {list.map((f) => (
                    <div key={f.id} className="frame-card" data-hidden={f.hidden}>
                      <div className="frame-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.src} alt={f.name} />
                      </div>
                      {editing?.id === f.id ? (
                        <>
                          <input
                            className="field"
                            value={editing.name}
                            maxLength={MAX_NAME}
                            aria-label="Nama frame"
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          />
                          <input
                            className="field"
                            list="frame-themes"
                            value={editing.theme}
                            maxLength={MAX_THEME}
                            placeholder={`Tema (kosong = ${UNSORTED_THEME})`}
                            aria-label="Tema"
                            onChange={(e) => setEditing({ ...editing, theme: e.target.value })}
                          />
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button className="pill pill-sm" onClick={() => void saveEdit()} disabled={savingEdit || !editing.name.trim()} style={{ flex: 1 }}>
                              {savingEdit ? 'Menyimpan…' : 'Simpan'}
                            </button>
                            <button className="pill pill-ghost pill-sm" onClick={() => setEditing(null)} disabled={savingEdit}>
                              Batal
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <b style={{ fontSize: 15 }}>{f.name}</b>
                          <span className="mono mono-sm">
                            {packageLabel(f.format)} ·{' '}
                            {new Date(f.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          <label className="checkbox frame-visible">
                            <input type="checkbox" checked={!f.hidden} disabled={toggling} onChange={(e) => void setHidden([f.id], !e.target.checked)} />
                            <span>{f.hidden ? 'Disembunyikan dari tamu' : 'Tampil ke tamu'}</span>
                          </label>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              className="pill pill-ghost pill-sm"
                              style={{ flex: 1 }}
                              onClick={() => setEditing({ id: f.id, name: f.name, theme: f.theme })}
                            >
                              Ubah
                            </button>
                            <button
                              className="pill pill-ghost pill-sm pill-danger-text"
                              onClick={() => {
                                setEditing(null);
                                setDeleteError(null);
                                setConfirmDelete(f.id);
                              }}
                            >
                              Hapus
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      {themeAction && (
        <ConfirmDialog
          title={`${themeAction.hide ? 'Sembunyikan' : 'Tampilkan'} tema ${themeAction.theme || UNSORTED_THEME}?`}
          confirmLabel={themeAction.hide ? 'Ya, sembunyikan' : 'Ya, tampilkan'}
          tone="normal"
          busy={toggling}
          error={error}
          onConfirm={() =>
            void setHidden(
              frames.filter((f) => f.theme === themeAction.theme).map((f) => f.id),
              themeAction.hide,
            )
          }
          onCancel={() => setThemeAction(null)}
        >
          <p>
            {themeAction.hide
              ? 'Semua frame di tema ini tidak ditawarkan ke tamu, mis. tema nikahan saat acara kantor. Frame tetap tersimpan dan bisa ditampilkan lagi kapan saja.'
              : 'Semua frame di tema ini ditawarkan lagi ke tamu di layar Hias.'}
          </p>
        </ConfirmDialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Hapus frame "${deleteTarget.name}"?`}
          confirmLabel="Ya, hapus frame"
          busy={deleting}
          error={deleteError}
          onConfirm={() => void remove(deleteTarget.id)}
          onCancel={() => setConfirmDelete(null)}
        >
          <p>
            Frame tema {deleteTarget.theme || UNSORTED_THEME} untuk paket {packageLabel(deleteTarget.format)} dihapus permanen. Tamu
            tidak bisa memilihnya lagi.
          </p>
          <p className="op-muted">Foto yang sudah jadi dengan frame ini tidak berubah.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
