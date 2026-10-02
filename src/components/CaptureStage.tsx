'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { Camera, Retry } from '@/components/guest/icons';
import type { CameraInfo } from '@/lib/camera/types';
import type { Session } from '@/lib/types';

const POSES = ['Senyum paling manis!', 'Gaya paling heboh!', 'Saling lihat, terus ketawa', 'Pose andalan kamu!'];
const FIRST_COUNT = 5;
const NEXT_COUNT = 3;
const SHOW_MS = 1600;

/** Shared with the operator camera page, which is where these are chosen. */
export const CAMERA_DEVICE_KEY = 'snaplorebooth.cameraDeviceId';
export const MIRROR_KEY = 'snaplorebooth.mirrorPreview';

type Phase = 'ready' | 'counting' | 'shooting' | 'showing' | 'error' | 'done';

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CaptureStage({ session, payments }: { session: Session; payments: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(true);
  const [shot, setShot] = useState(1);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(FIRST_COUNT);
  const [flash, setFlash] = useState(false);
  const [snap, setSnap] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  // A tethered body streams live view from the server; a webcam or capture card does not.
  const tethered = camera?.serverLiveView === true;

  useEffect(() => {
    setMirrored(readSetting(MIRROR_KEY) !== 'false');
    let cancelled = false;
    fetch('/api/camera', { cache: 'no-store' })
      .then((res) => res.json() as Promise<CameraInfo>)
      .then((info) => {
        if (cancelled) return;
        setCamera(info);
        if (info.serverLiveView && !info.ready) setCameraProblem(info.message ?? 'Kamera belum terhubung.');
      })
      .catch(() => !cancelled && setCameraProblem('Booth tidak bisa menghubungi kamera.'));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (camera === null || tethered) return;
    let cancelled = false;
    const deviceId = readSetting(CAMERA_DEVICE_KEY);
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };

    navigator.mediaDevices
      ?.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size },
        audio: false,
      })
      .catch(() =>
        // The saved camera may be unplugged; any working camera beats an empty booth.
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...size }, audio: false }),
      )
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err: unknown) => {
        if (!cancelled) setCameraProblem(err instanceof Error ? err.message : 'Akses kamera ditolak.');
      });

    if (!navigator.mediaDevices) setCameraProblem('Kamera hanya bisa dipakai lewat HTTPS.');

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, tethered]);

  /** Saves what the sensor saw: no mirror, no filter. Looks are chosen later and applied once. */
  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  const takeOne = useCallback(
    async (index: number): Promise<string> => {
      if (tethered) {
        const res = await fetch('/api/camera/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, index }),
        });
        const data = (await res.json()) as { photo?: { file: string }; error?: string };
        if (!res.ok || !data.photo) throw new Error(data.error);
        return `/api/media/${data.photo.file.split('/').map(encodeURIComponent).join('/')}`;
      }

      const dataUrl = grabFrame();
      if (!dataUrl) throw new Error('no frame');
      const res = await fetch(`/api/sessions/${session.id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, dataUrl }),
      });
      if (!res.ok) throw new Error('save failed');
      return dataUrl;
    },
    [grabFrame, session.id, tethered],
  );

  const shoot = useCallback(async () => {
    const index = shot;
    setFlash(true);
    setTimeout(() => setFlash(false), 480);
    try {
      const src = await takeOne(index);
      setThumbs((current) => ({ ...current, [index]: src }));
      setSnap(src);
      setPhase('showing');
      await wait(SHOW_MS);
      setSnap(null);

      if (index >= session.shots) {
        setPhase('done');
        await fetch(`/api/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'reviewing' }),
        });
        router.push(`/review/${session.id}`);
        return;
      }
      setShot(index + 1);
      setCount(NEXT_COUNT);
      setPhase('counting');
    } catch {
      setPhase('error');
    }
  }, [router, session.id, session.shots, shot, takeOne]);

  const shootRef = useRef(shoot);
  shootRef.current = shoot;

  useEffect(() => {
    if (phase !== 'counting') return;
    if (count <= 0) {
      setPhase('shooting');
      void shootRef.current();
      return;
    }
    const timer = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, count]);

  const begin = () => {
    setCount(FIRST_COUNT);
    setPhase('counting');
  };

  const retry = () => {
    setCount(NEXT_COUNT);
    setPhase('counting');
  };

  return (
    <main className="cap">
      {tethered ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cap-feed" src="/api/camera/liveview" alt="" />
      ) : (
        <video
          ref={videoRef}
          className="cap-feed"
          autoPlay
          playsInline
          muted
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
        />
      )}

      <div className="cap-top">
        <div style={{ width: '100%' }}>
          <GuestHeader step="foto" payments={payments} />
        </div>
      </div>

      {phase === 'counting' && count > 0 && (
        <div className="cap-count" aria-live="assertive">
          <span key={`${shot}-${count}`}>{count}</span>
        </div>
      )}
      {flash && <div className="cap-flash" />}
      {snap && (
        <div className="cap-snap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={snap} alt={`Foto ${shot}`} />
        </div>
      )}

      <div className="cap-bottom">
        {phase === 'ready' ? (
          <>
            <div className="cap-pose">
              {session.shots > 1 ? `Siap? Ada ${session.shots} pose, ganti gaya tiap hitungan.` : 'Siap? Satu foto, bikin yang terbaik.'}
            </div>
            <button className="g-cta" onClick={begin} disabled={camera === null || !!cameraProblem}>
              <Camera /> Mulai foto
            </button>
          </>
        ) : phase === 'error' ? (
          <>
            <div className="cap-pose">Ups, foto {shot} belum tersimpan.</div>
            <button className="g-cta" onClick={retry}>
              <Retry /> Coba lagi
            </button>
          </>
        ) : (
          <div className="cap-pose">{phase === 'done' ? 'Mantap! Lanjut hias fotomu…' : POSES[(shot - 1) % POSES.length]}</div>
        )}

        {session.shots > 1 && (
          <div className="cap-shots">
            {Array.from({ length: session.shots }, (_, i) => i + 1).map((n) => (
              <div key={n} className="cap-shot" data-active={n === shot && phase !== 'done'}>
                {thumbs[n] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[n]} alt={`Foto ${n}`} />
                ) : (
                  n
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {cameraProblem && (
        <div className="cap-problem">
          <div>
            <h1 className="g-title">Kameranya lagi istirahat sebentar</h1>
            <p className="g-lead">Panggil petugas booth ya — sesimu aman dan tidak hilang.</p>
            <button
              className="g-cta"
              onClick={() => {
                setCameraProblem(null);
                setCamera(null);
                setReloadKey((k) => k + 1);
              }}
            >
              <Retry /> Coba lagi
            </button>
            <p className="mono" style={{ marginTop: 12 }}>{cameraProblem}</p>
          </div>
        </div>
      )}
    </main>
  );
}
