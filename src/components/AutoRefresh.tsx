'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the page's server data while it is on screen, so a phone left open stays current. */
export default function AutoRefresh({ renderedAt, everyMs = 15_000 }: { renderedAt: string; everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === 'visible' && router.refresh(), everyMs);
    // Back from the lock screen or another app: refresh at once.
    const onVisible = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, everyMs]);

  return (
    <span className="op-chip op-live" data-tone="ok" title="Diperbarui otomatis tiap 15 detik">
      Live · {new Date(renderedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}
