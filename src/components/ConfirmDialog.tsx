'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * Every change in the console that cannot be taken back goes through this: what will happen,
 * then one deliberate press. A typed word is asked on top for the biggest ones.
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = 'danger',
  typeWord,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'normal';
  /** When set, the confirm button waits until this word is typed. */
  typeWord?: string | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const ready = !typeWord || typed.trim().toUpperCase() === typeWord;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="op-dialog-backdrop" onClick={() => !busy && onCancel()}>
      <div className="op-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        <div className="op-dialog-body">{children}</div>
        {typeWord && (
          <label className="op-field">
            <span className="op-label">Ketik {typeWord} untuk konfirmasi</span>
            <input
              className="field"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={typeWord}
              autoFocus
            />
          </label>
        )}
        {error && <div className="notice notice-error">{error}</div>}
        <div className="op-dialog-actions">
          <button className="pill pill-ghost" onClick={onCancel} disabled={busy}>
            Batal
          </button>
          <button className={tone === 'danger' ? 'pill pill-danger' : 'pill'} onClick={onConfirm} disabled={busy || !ready}>
            {busy ? 'Memproses…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
