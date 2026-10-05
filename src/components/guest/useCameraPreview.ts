'use client';

import { useEffect, useState, type RefObject } from 'react';
import { CAMERA_DEVICE_KEY, CAMERA_SOURCE_KEY, readDeviceSetting as readSetting } from '@/components/guest/deviceKeys';
import { useTetheredFeed } from '@/components/guest/useTetheredFeed';
import type { CameraInfo } from '@/lib/camera/types';

export type PreviewSource = 'device' | 'tethered' | null;

/**
 * The camera the photo session will use, as a picture for a preview: the Canon when this
 * device chose it and it answers, else this device's own camera. Never an error screen: when
 * neither works the preview simply shows stand-ins, and the photo session deals with it.
 * Plays into the given video (this device) or canvas (Canon live view).
 */
export function useCameraPreview(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled = true,
): PreviewSource {
  const [source, setSource] = useState<PreviewSource>(null);
  const [tethered, setTethered] = useState<{ stillAspect: number | null } | null>(null);

  useTetheredFeed(canvasRef, tethered !== null, tethered?.stillAspect ?? null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;

    if (readSetting(CAMERA_SOURCE_KEY) === 'canon') {
      fetch('/api/camera', { cache: 'no-store' })
        .then((res) => res.json() as Promise<CameraInfo>)
        .then((info) => {
          if (cancelled || !info.serverLiveView || !info.ready) return;
          setTethered({ stillAspect: info.stillAspect ?? null });
          setSource('tethered');
        })
        .catch(() => undefined);
    } else if (navigator.mediaDevices) {
      const deviceId = readSetting(CAMERA_DEVICE_KEY);
      const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
      navigator.mediaDevices
        .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...size }, audio: false }))
        .then((s) => {
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          const video = videoRef.current;
          if (!video) return;
          video.srcObject = s;
          void video.play().catch(() => undefined);
          setSource('device');
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, enabled]);

  return source;
}
