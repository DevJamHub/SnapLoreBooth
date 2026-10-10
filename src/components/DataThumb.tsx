'use client';

import { useCallback, useState } from 'react';

/**
 * A stored photo or clip shown in a Konsol → Data cell, opening full size in a new tab. Files
 * go when retention or the guest erases them while the row stays, so a missing one says so.
 */
export default function DataThumb({ kind, src, label }: { kind: 'image' | 'video'; src: string; label: string }) {
  const [gone, setGone] = useState(false);
  // An error that fired before hydration never reaches onError; look once the element is ours.
  const imageRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setGone(true);
  }, []);
  const videoRef = useCallback((video: HTMLVideoElement | null) => {
    if (video?.error) setGone(true);
  }, []);

  if (gone) return <span className="op-db-gone">file sudah dihapus</span>;
  return (
    <a className="op-db-thumb" href={src} target="_blank" rel="noreferrer" title={`Buka ${label}`}>
      {kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={imageRef} src={src} alt={label} loading="lazy" onError={() => setGone(true)} />
      ) : (
        <video ref={videoRef} src={src} muted playsInline preload="metadata" aria-label={label} onError={() => setGone(true)} />
      )}
    </a>
  );
}
