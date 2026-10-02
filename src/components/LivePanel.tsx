'use client';

import { useEffect, useState } from 'react';
import LoopVideo from '@/components/LoopVideo';

const POLL_MS = 3000;
const GIVE_UP_MS = 2 * 60_000;

const mediaUrl = (file: string) => `/api/media/${file.split('/').map(encodeURIComponent).join('/')}`;

/**
 * The live sheet on the guest's phone. A guest often scans the QR while the booth is still
 * recording it, so this waits for it to appear rather than showing nothing.
 */
export default function LivePanel({ sessionId, initialFile, poster }: { sessionId: string; initialFile: string | null; poster: string }) {
  const [file, setFile] = useState(initialFile);
  const [gaveUp, setGaveUp] = useState(false);

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
      <p className="g-kicker">Video live</p>
      {file ? (
        <>
          <LoopVideo src={mediaUrl(file)} poster={poster} />
          <a className="g-ghost" href={mediaUrl(file)} download={`snaplorebooth-${sessionId}-live.${file.split('.').pop()}`}>
            Download video live
          </a>
        </>
      ) : (
        <p className="g-lead" style={{ fontSize: 16 }}>Video live sedang dibuat di booth… halaman ini akan memperbaruinya sendiri.</p>
      )}
    </div>
  );
}
