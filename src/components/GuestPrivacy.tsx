'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/guest/lang';

/**
 * On the page the QR opens: the guest may leave a contact for the operator's promotions (only
 * with the consent box ticked), and may delete their photos and videos there and then.
 */
export function ContactCard({ sessionId, question, answers }: { sessionId: string; question: string; answers: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [instagram, setInstagram] = useState('');
  const [answer, setAnswer] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, instagram, answer, consent }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Belum tersimpan. Coba lagi, ya.');
      setSaved(true);
    } catch (err) {
      setError(t(err instanceof Error ? err.message : 'Belum tersimpan. Coba lagi, ya.'));
    } finally {
      setBusy(false);
    }
  };

  if (saved) return <p className="dl-card dl-thanks">{t('Terima kasih, {name}! Kami kabari kalau ada promo dan acara seru berikutnya.', { name: name.split(' ')[0] })}</p>;

  if (!open) {
    return (
      <button className="dl-card dl-card-button" onClick={() => setOpen(true)}>
        <b>{t('Mau dapat promo & info acara berikutnya?')}</b>
        <span>{t('Tinggalkan kontakmu — tidak wajib.')}</span>
      </button>
    );
  }

  return (
    <div className="dl-card dl-form">
      <b>{t('Tinggalkan kontakmu')}</b>
      <input className="dl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Nama')} maxLength={40} autoComplete="name" />
      <input
        className="dl-input"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={t('Nomor WhatsApp (mis. 0812…)')}
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
      />
      <input className="dl-input" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder={t('Instagram (boleh kosong)')} maxLength={40} autoCapitalize="none" />
      {question && answers.length > 0 && (
        <div className="dl-question">
          <span>{t(question)}</span>
          <div>
            {answers.map((a) => (
              <button key={a} type="button" aria-pressed={answer === a} onClick={() => setAnswer(answer === a ? '' : a)}>
                {t(a)}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="dl-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t('Saya setuju data ini disimpan dan dipakai pengelola booth untuk mengirim info promo. Bisa minta dihapus kapan saja ke petugas.')}</span>
      </label>
      {error && <p className="dl-error">{error}</p>}
      <button className="g-cta" onClick={send} disabled={busy || !consent || !name.trim()}>
        {t(busy ? 'Menyimpan…' : 'Kirim')}
      </button>
    </div>
  );
}

export function EraseButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const erase = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/erase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Belum bisa dihapus. Coba lagi sebentar.');
      router.refresh();
    } catch (err) {
      setError(t(err instanceof Error ? err.message : 'Belum bisa dihapus. Coba lagi sebentar.'));
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <button className="dl-erase" onClick={() => setAsking(true)}>
        {t('Hapus fotoku dari server')}
      </button>
    );
  }
  return (
    <div className="dl-card dl-erase-ask" role="alertdialog" aria-label={t('Hapus fotoku')}>
      <b>{t('Hapus semua foto & video ini sekarang?')}</b>
      <span>{t('Link ini tidak bisa dibuka lagi dan fotonya hilang dari galeri acara. Simpan dulu yang kamu mau. Tidak bisa dibatalkan.')}</span>
      {error && <p className="dl-error">{error}</p>}
      <div className="dl-share-row">
        <button className="g-ghost" onClick={() => setAsking(false)} disabled={busy}>
          {t('Batal')}
        </button>
        <button className="g-cta dl-erase-yes" onClick={erase} disabled={busy}>
          {t(busy ? 'Menghapus…' : 'Ya, hapus')}
        </button>
      </div>
    </div>
  );
}
