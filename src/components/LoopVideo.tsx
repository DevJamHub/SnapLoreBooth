'use client';

import { useEffect, useRef } from 'react';

/**
 * A silent, looping clip that plays like a GIF. React leaves `muted` out of server-rendered
 * HTML, and browsers refuse to autoplay a video they do not see as muted, so it is set on
 * the element and playback is started here.
 */
export default function LoopVideo({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    // Cleared by the previous cleanup (a new src, or React's development double mount).
    if (video.getAttribute('src') !== src) video.setAttribute('src', src);
    void video.play().catch(() => undefined);
    // The gallery screen swaps its videos every few seconds for hours. iOS decodes only a few
    // at once and keeps a removed one's decoder until its source is cleared.
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  return <video ref={ref} src={src} poster={poster} autoPlay loop muted playsInline preload="auto" />;
}
