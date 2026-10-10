import { notFound } from 'next/navigation';
import ClipCard from '@/components/ClipCard';
import { ContactCard, EraseButton } from '@/components/GuestPrivacy';
import { LangProvider } from '@/components/guest/lang';
import LivePanel from '@/components/LivePanel';
import ShareTools from '@/components/ShareTools';
import { getConfig, sheetText } from '@/lib/config';
import { getSession, listPhotos } from '@/lib/db';
import { eventById } from '@/lib/events';
import { mediaUrl } from '@/lib/format';
import { dateLocale, langOf, translate, type Vars } from '@/lib/i18n';
import { canMakeMotion } from '@/lib/motion';
import { publicBaseUrl } from '@/lib/publicUrl';
import { retentionHours } from '@/lib/retention';

export const dynamic = 'force-dynamic';

/** What a guest's phone opens after scanning the booth QR code. */
export default async function DownloadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  // In the language the guest chose at the booth.
  const lang = langOf(session?.lang);
  const t = (text: string, vars?: Vars) => translate(lang, text, vars);
  if (session?.erased_at) {
    return (
      <main className="dl">
        <span className="g-logo">
          Snaplore<span>Booth</span>
        </span>
        <h1 className="g-title" style={{ fontSize: 34 }}>{t('Fotomu sudah dihapus')}</h1>
        <p className="g-lead" style={{ fontSize: 17 }}>
          {t('Semua foto dan video dari sesi ini sudah dihapus dari server atas permintaanmu. Terima kasih sudah mampir!')}
        </p>
      </main>
    );
  }
  if (!session || !session.strip_file) notFound();

  const photos = listPhotos(id);
  const clips = photos.filter((p) => p.clip_file);
  const config = getConfig();
  // Waiting for a whole-sheet video only makes sense while the booth makes them.
  const live = clips.length > 0 && (session.live_file !== null || config.share.liveVideo);
  const motion = canMakeMotion();
  const eventName = sheetText((session.event_id && eventById(session.event_id)?.name) || 'SnaploreBooth', config);
  const keptUntil = new Date(new Date(session.created_at).getTime() + retentionHours() * 3600_000).toLocaleDateString(dateLocale(lang), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <LangProvider lang={lang}>
      <main className="dl">
        <span className="g-logo">
          Snaplore<span>Booth</span>
        </span>
        <h1 className="g-title" style={{ fontSize: 40 }}>{t('Fotomu sudah siap')}</h1>
        {config.share.message && <p className="dl-message">{config.share.message}</p>}
        <p className="g-lead" style={{ fontSize: 17 }}>
          {t('Tekan lama pada foto atau video lalu pilih Simpan, atau pakai tombol download.')}
        </p>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="dl-board" src={mediaUrl(session.strip_file)} alt={t('Hasil fotomu')} />

        <a className="g-cta" href={mediaUrl(session.strip_file)} download={`snaplorebooth-${session.id}.jpeg`}>
          {t('Download foto')}
        </a>

        <ShareTools
          sessionId={session.id}
          sheetSrc={mediaUrl(session.strip_file)}
          eventName={eventName}
          text={t('Fotoku di {event} 📸', { event: eventName })}
          link={`${await publicBaseUrl()}/d/${session.id}`}
        />

        {config.share.contacts && <ContactCard sessionId={session.id} question={config.share.question} answers={config.share.answers} />}

        {live && <LivePanel sessionId={session.id} initialFile={session.live_file} poster={mediaUrl(session.strip_file)} canGif={motion} />}

        {clips.length > 0 && (
          <>
            <p className="g-kicker" style={{ marginTop: 16 }}>{t('Video per foto · {n}', { n: clips.length })}</p>
            <div className="dl-clips" data-mirror={session.mirror}>
              {clips.map((photo) => (
                <ClipCard
                  key={photo.id}
                  sessionId={session.id}
                  index={photo.idx}
                  clip={mediaUrl(photo.clip_file!)}
                  poster={mediaUrl(photo.file)}
                  canBoomerang={motion}
                />
              ))}
            </div>
          </>
        )}

        {photos.length > 1 && (
          <>
            <p className="g-kicker" style={{ marginTop: 16 }}>{t('Foto satuan')}</p>
            <div className="dl-frames" data-mirror={session.mirror}>
              {photos.map((photo) => (
                <a key={photo.id} href={mediaUrl(photo.file)} download={`snaplorebooth-${session.id}-${photo.idx}.jpeg`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(photo.file)} alt={t('Foto {n}', { n: photo.idx })} />
                </a>
              ))}
            </div>
          </>
        )}

        <p className="dl-privacy">{t('Foto dan video ini tersimpan sampai {date}, lalu dihapus otomatis.', { date: keptUntil })}</p>
        {config.share.erase && <EraseButton sessionId={session.id} />}
      </main>
    </LangProvider>
  );
}
