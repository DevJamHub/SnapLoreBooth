'use client';

import { useEffect, useState } from 'react';
import LoopVideo from '@/components/LoopVideo';
import { useMotion } from '@/components/ShareTools';
import { useT } from '@/components/guest/lang';
import { mediaUrl } from '@/lib/format';

const POLL_MS = 3000;
const GIVE_UP_MS = 2 * 60_000;

/**
 * The live sheet on the guest's phone. A guest often scans the QR while the booth is still
 * recording it, so this waits for it to appear rather than showing nothing.
 */
export default function LivePanel({
  sessionId,
  initialFile,
  poster,
  canGif,
}: {
  sessionId: string;
  initialFile: string | null;
  poster: string;
  /** The server has ffmpeg to make a GIF of it. */
  canGif: boolean;
}) {
  const t = useT();
  const [file, setFile] = useState(initialFile);
  const [gaveUp, setGaveUp] = useState(false);
  const { motion: gif, make: makeGif } = useMotion(sessionId, { kind: 'gif' });

  useEffect(() => {
    if (file) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > GIVE_UP_MS) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, { cache: 'no-store' });
        const data = (await res.json()) as { session?: { live_file: string | null } };
        if (data.session?.live_file) setFile(data.session.live_file);
      } catch {
        // Patchy signal at a party; try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [file, sessionId]);

  if (gaveUp && !file) return null;

  return (
    <div className="dl-live">
      <p className="g-kicker">{t('Video live')}</p>
      {file ? (
        <>
          <LoopVideo src={mediaUrl(file)} poster={poster} />
          <div className="dl-share-row">
            <a className="g-ghost" href={mediaUrl(file)} download={`snaplorebooth-${sessionId}-live.${file.split('.').pop()}`}>
              {t('Download video live')}
            </a>
            {canGif &&
              (gif.state === 'ready' ? (
                <a className="g-ghost" href={gif.url} download={`snaplorebooth-${sessionId}.gif`}>
                  {t('Download GIF')}
                </a>
              ) : (
                <button className="g-ghost" onClick={makeGif} disabled={gif.state === 'making'}>
                  {t(gif.state === 'making' ? 'Membuat GIF…' : gif.state === 'failed' ? 'GIF gagal, coba lagi' : 'Jadikan GIF')}
                </button>
              ))}
          </div>
          {gif.state === 'ready' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="dl-gif" src={gif.url} alt={t('GIF fotomu')} />
          )}
        </>
      ) : (
        <p className="g-lead" style={{ fontSize: 16 }}>{t('Video live sedang dibuat di booth… halaman ini akan memperbaruinya sendiri.')}</p>
      )}
    </div>
  );
}
