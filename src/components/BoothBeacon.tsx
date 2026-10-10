'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { CAMERA_SOURCE_KEY } from '@/components/guest/deviceKeys';

const BEAT_MS = 30_000;
const DEVICE_KEY = 'snaplorebooth.deviceId';

/** Guest steps, by the path their screen lives at. Other pages (console, QR, gallery) stay quiet. */
const STEPS: [RegExp, string][] = [
  [/^\/$/, 'Standby'],
  [/^\/paket/, 'Pilih paket'],
  [/^\/hias\//, 'Hias'],
  [/^\/pay\//, 'Bayar'],
  [/^\/capture\//, 'Foto'],
  [/^\/gaya\//, 'Gaya warna'],
  [/^\/share\//, 'Cetak'],
];

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // randomUUID only exists on https and localhost; an iPad on http://<LAN IP> has none.
      id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'tanpa-penyimpanan';
  }
}

/** iPadOS presents itself as a Mac; touch gives it away. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android tablet';
  // Chrome on a large Android tablet asks for desktop sites, saying Linux; touch gives it away.
  if (/Linux/.test(ua) && navigator.maxTouchPoints > 1) return 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Perangkat';
}

type BatteryManager = { level: number; charging: boolean };

/**
 * Tells the console this booth screen is alive: which step it shows and with which camera.
 * Sent every 30 s and on every step change, from the guest screens only.
 */
export default function BoothBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const step = STEPS.find(([pattern]) => pattern.test(pathname));
    if (!step) return;
    const session = /\/(SB[A-Z0-9]{6})/.exec(pathname)?.[1] ?? null;

    const beat = async () => {
      let camera = 'Kamera perangkat';
      try {
        if (localStorage.getItem(CAMERA_SOURCE_KEY) === 'canon') camera = 'Canon';
      } catch {
        // Unreadable: the default camera.
      }
      const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
      const battery = await nav.getBattery?.().catch(() => null);
      void fetch('/api/booth/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          id: deviceId(),
          device: deviceName(),
          page: step[1],
          session,
          camera,
          screen: `${window.screen.width}×${window.screen.height}`,
          battery: battery ? battery.level * 100 : null,
          charging: battery ? battery.charging : null,
        }),
      }).catch(() => undefined);
    };

    void beat();
    const timer = setInterval(() => void beat(), BEAT_MS);
    return () => clearInterval(timer);
  }, [pathname]);

  return null;
}
