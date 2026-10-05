'use client';

import { useEffect, useRef, useState } from 'react';
import { CAMERA_DEVICE_KEY, readDeviceSetting } from '@/components/guest/deviceKeys';

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice applies to this preview only.
  }
}

/**
 * Picks which camera the kiosk uses — the iPad's own, or the Canon through an HDMI capture
 * card. Saved on this device, which is the one the guests use. The preview is mirrored as the
 * event's setting says, exactly as guests will see it.
 */
export default function BrowserCameraPanel({ mirror }: { mirror: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setDeviceId(readDeviceSetting(CAMERA_DEVICE_KEY) ?? '');
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices) {
      setProblem('Kamera hanya bisa dipakai lewat HTTPS.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 } } : { facingMode: 'user', width: { ideal: 1920 } },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setProblem(null);
        if (videoRef.current) videoRef.current.srcObject = s;
        // Labels only appear once permission is granted, so enumerate afterwards.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
      })
      .catch((err: unknown) => !cancelled && setProblem(err instanceof Error ? err.message : 'kamera tidak tersedia'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
  const resolution = track?.getSettings();

  return (
    <>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <span className="mono">KAMERA UNTUK TAMU (TERSIMPAN DI PERANGKAT INI)</span>
        <label className="field-label">
          <span className="mono mono-sm">SUMBER</span>
          <select
            className="field"
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              write(CAMERA_DEVICE_KEY, e.target.value);
            }}
          >
            <option value="">Kamera depan (default)</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Kamera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        {resolution?.width && (
          <span className="mono mono-sm">
            RESOLUSI {resolution.width}×{resolution.height}
          </span>
        )}
        {problem && <div className="notice notice-error">{problem}</div>}
        <p className="muted" style={{ fontSize: 14 }}>
          Canon lewat HDMI capture card muncul sebagai kamera USB (biasanya bernama &quot;USB Video&quot; atau nama merek capture card).
        </p>
      </div>
      <div className="viewfinder">
        <video ref={videoRef} autoPlay playsInline muted style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
      </div>
    </>
  );
}
