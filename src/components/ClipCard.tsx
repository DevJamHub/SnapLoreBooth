'use client';

import LoopVideo from '@/components/LoopVideo';
import { useT } from '@/components/guest/lang';
import { useMotion } from '@/components/ShareTools';

/** One photo's countdown clip on the QR page, which the guest can turn into a boomerang. */
export default function ClipCard({
  sessionId,
  index,
  clip,
  poster,
  canBoomerang,
}: {
  sessionId: string;
  index: number;
  clip: string;
  poster: string;
  /** The server has ffmpeg to make one. */
  canBoomerang: boolean;
}) {
  const t = useT();
  const { motion, make } = useMotion(sessionId, { kind: 'boomerang', index });
  const boomerang = motion.state === 'ready' ? motion.url : null;
  const ext = boomerang ? 'mp4' : (clip.split('?')[0].split('.').pop() ?? 'mp4');

  return (
    // A boomerang is made already flipped for a mirrored session; the raw clip is flipped here.
    <figure data-boomerang={!!boomerang}>
      <LoopVideo src={boomerang ?? clip} poster={poster} />
      <div className="dl-clip-actions">
        <a href={boomerang ?? clip} download={`snaplorebooth-${sessionId}-${index}${boomerang ? '-boomerang' : ''}.${ext}`}>
          {boomerang ? t('Download boomerang') : t('Download video {n}', { n: index })}
        </a>
        {canBoomerang && !boomerang && (
          <button type="button" onClick={make} disabled={motion.state === 'making'}>
            {t(motion.state === 'making' ? 'Membuat…' : motion.state === 'failed' ? 'Coba lagi' : 'Boomerang')}
          </button>
        )}
      </div>
    </figure>
  );
}
