'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { ArrowRight, Camera, Retry } from '@/components/guest/icons';
import type { CameraInfo } from '@/lib/camera/types';
import { boardLayout, composeStrip } from '@/lib/strip';
import type { CustomFrame, Session } from '@/lib/types';

const POSES = [
  'Senyum paling manis!',
  'Gaya paling heboh!',
  'Saling lihat, terus ketawa',
  'Pose andalan kamu!',
  'Pasang muka kaget!',
  'Rapat-rapat, peluk!',
];
/** Every shot counts down this long, and the live clip records these same seconds. */
const COUNT_FROM = 3;
const SHOW_MS = 1200;
/** The whole photo session; when it ends, missing shots are taken and the sheet prints. */
const SESSION_SECONDS = 10 * 60;
const CLIP_BITRATE = 2_500_000;
const CLIP_UPLOAD_WAIT_MS = 8000;

/** Shared with the operator camera page, which is where these are chosen. */
export const CAMERA_DEVICE_KEY = 'snaplorebooth.cameraDeviceId';
export const MIRROR_KEY = 'snaplorebooth.mirrorPreview';

type Phase = 'ready' | 'counting' | 'shooting' | 'showing' | 'review' | 'error' | 'finishing';

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Safari records MP4, Chrome either; null when this browser cannot record at all. */
function clipMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? null;
}

interface Recording {
  recorder: MediaRecorder;
  done: Promise<Blob | null>;
}

export default function CaptureStage({
  session,
  payments,
  eventName,
  initialShots,
  frame,
}: {
  session: Session;
  payments: boolean;
  eventName: string;
  initialShots: Record<number, string>;
  /** The uploaded frame the guest chose in Hias; null for a built-in one. */
  frame: CustomFrame | null;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const clipChain = useRef<Promise<unknown>>(Promise.resolve());
  const autoFinish = useRef(false);

  const slots = useMemo(() => Array.from({ length: session.shots }, (_, i) => i + 1), [session.shots]);
  const layout = useMemo(
    () => boardLayout(session.format, session.template, session.shots, frame),
    [session.format, session.template, session.shots, frame],
  );

  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mirrored, setMirrored] = useState(true);
  const [shots, setShots] = useState<Record<number, string>>(initialShots);
  const [queue, setQueue] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (slots.every((n) => initialShots[n]) ? 'review' : 'ready'));
  const [count, setCount] = useState(COUNT_FROM);
  const [flash, setFlash] = useState(false);
  const [snap, setSnap] = useState<string | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** First tap on a finished photo selects it (white border); a second tap retakes it. */
  const [selected, setSelected] = useState<number | null>(null);

  // A tethered body streams live view from the server; a webcam or capture card does not.
  const tethered = camera?.serverLiveView === true;
  const complete = slots.every((n) => shots[n]);

  useEffect(() => {
    void fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'capturing' }),
    });
  }, [session.id]);

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
    if (!navigator.mediaDevices) {
      setCameraProblem('Kamera hanya bisa dipakai lewat HTTPS.');
      return;
    }
    const deviceId = readSetting(CAMERA_DEVICE_KEY);
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };

    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size }, audio: false })
      // The saved camera may be unplugged; any working camera beats an empty booth.
      .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', ...size }, audio: false }))
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((err: unknown) => !cancelled && setCameraProblem(err instanceof Error ? err.message : 'Akses kamera ditolak.'));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, tethered]);

  // The right-hand sheet fills in shot by shot, in the frame and look chosen in Hias.
  useEffect(() => {
    let cancelled = false;
    composeStrip(
      slots.map((n) => shots[n] ?? null),
      { format: session.format, filterId: session.filter, templateId: session.template, eventName, capturedAt: new Date(session.created_at), frame },
      0.75,
    )
      .then((url) => !cancelled && setBoard(url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [shots, slots, session.format, session.filter, session.template, session.created_at, eventName, frame]);

  /** Starts recording the countdown, so every shot also gets its few seconds of video. */
  const startClip = useCallback(() => {
    const stream = streamRef.current;
    const mimeType = clipMimeType();
    if (tethered || !stream || !mimeType) return;
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: CLIP_BITRATE });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      const done = new Promise<Blob | null>((resolve) => {
        recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: mimeType.split(';')[0] }) : null);
        recorder.onerror = () => resolve(null);
      });
      recorder.start();
      recordingRef.current = { recorder, done };
    } catch {
      // A browser that cannot record still takes the photo.
      recordingRef.current = null;
    }
  }, [tethered]);

  const stopClip = useCallback(async (): Promise<Blob | null> => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording || recording.recorder.state === 'inactive') return null;
    recording.recorder.stop();
    return recording.done;
  }, []);

  /** Uploads run one after another so a retake's clip always lands after the one it replaces. */
  const queueClipUpload = useCallback(
    (index: number, blob: Blob) => {
      clipChain.current = clipChain.current
        .then(() =>
          fetch(`/api/sessions/${session.id}/clips?index=${index}`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }),
        )
        .catch(() => undefined);
    },
    [session.id],
  );

  /** Saves what the sensor saw: no mirror, no filter. The look is applied once, on the sheet. */
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

  const takeStill = useCallback(
    async (index: number): Promise<string> => {
      if (tethered) {
        const res = await fetch('/api/camera/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, index }),
        });
        const data = (await res.json()) as { photo?: { file: string }; error?: string };
        if (!res.ok || !data.photo) throw new Error(data.error);
        return `/api/media/${data.photo.file.split('/').map(encodeURIComponent).join('/')}?v=${Date.now()}`;
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

  const begin = useCallback(
    (indices: number[]) => {
      if (indices.length === 0) return;
      setSelected(null);
      setFailed(false);
      setCurrent(indices[0]);
      setQueue(indices.slice(1));
      setCount(COUNT_FROM);
      setPhase('counting');
      startClip();
    },
    [startClip],
  );

  const finish = useCallback(async () => {
    setPhase('finishing');
    setFailed(false);
    try {
      // Give live clips a moment to finish uploading so the QR page has them.
      await Promise.race([clipChain.current, wait(CLIP_UPLOAD_WAIT_MS)]);
      const dataUrl = await composeStrip(
        slots.map((n) => shots[n]),
        { format: session.format, filterId: session.filter, templateId: session.template, eventName, capturedAt: new Date(session.created_at), frame },
      );
      const res = await fetch(`/api/sessions/${session.id}/strip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) throw new Error();
      router.push(`/share/${session.id}`);
    } catch {
      setFailed(true);
      setPhase('review');
    }
  }, [eventName, frame, router, session.created_at, session.filter, session.format, session.id, session.template, shots, slots]);

  const shoot = useCallback(async () => {
    const index = current;
    if (index === null) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 480);
    try {
      const src = await takeStill(index);
      // Keep recording a beat past the shutter, then stop: the clip ends on the moment of the photo.
      void wait(150).then(stopClip).then((blob) => blob && queueClipUpload(index, blob));
      setShots((prev) => ({ ...prev, [index]: src }));
      setSnap(src);
      setPhase('showing');
      await wait(SHOW_MS);
      setSnap(null);

      if (queue.length > 0) {
        begin(queue);
        return;
      }
      setCurrent(null);
      setPhase('review');
    } catch {
      void stopClip();
      setPhase('error');
    }
  }, [begin, current, queue, queueClipUpload, stopClip, takeStill]);

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

  // When the session clock runs out, the sheet finishes itself as soon as it is whole.
  useEffect(() => {
    if (phase === 'review' && autoFinish.current && complete) void finish();
  }, [complete, finish, phase]);

  const onSessionEnd = () => {
    autoFinish.current = true;
    if (phase === 'ready' || phase === 'review' || phase === 'error') {
      const missing = slots.filter((n) => !shots[n]);
      if (missing.length > 0) begin(missing);
    }
  };
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;
  const left = useCountdown(SESSION_SECONDS, true, () => onSessionEndRef.current());

  const tapSlot = (index: number) => {
    if (phase !== 'review' || !shots[index]) return;
    if (selected === index) begin([index]);
    else setSelected(index);
  };

  const shotNumber = current ?? slots.find((n) => !shots[n]) ?? session.shots;
  // Uploaded frames can mix photo shapes, so the viewfinder takes the shape of the shot being taken.
  const activeSlot = layout.slots[shotNumber - 1] ?? layout.slots[0];
  const slotAspect = activeSlot.w / activeSlot.h;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <main className="g-screen cap2">
      <GuestHeader step="foto" payments={payments} right={<span className="cap2-clock">{formatClock(left)}</span>} />

      <div className="cap2-body">
        <section className="cap2-camera">
          <div className="fit cq">
            <div className="vf" style={{ aspectRatio: String(slotAspect), width: `min(100cqw, calc(100cqh * ${slotAspect}))` }}>
              {tethered ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="vf-feed" src="/api/camera/liveview" alt="" />
              ) : (
                <video ref={videoRef} className="vf-feed" autoPlay playsInline muted style={{ transform: mirrored ? 'scaleX(-1)' : undefined }} />
              )}
              {phase === 'counting' && count > 0 && (
                <div className="vf-count" aria-live="assertive">
                  <span key={`${current}-${count}`}>{count}</span>
                </div>
              )}
              {(phase === 'counting' || phase === 'shooting') && <span className="vf-rec">● REC</span>}
              {flash && <div className="cap-flash" />}
              {snap && (
                <div className="vf-snap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={snap} alt={`Foto ${current}`} />
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="cap2-sheet">
          <p className="cap2-sheet-hint" data-active={phase === 'review'}>
            {phase === 'review' ? 'Klik 2 kali pada foto untuk retake' : 'Frame kamu'}
          </p>
          <div className="fit cq">
            <div className="sheet" style={{ aspectRatio: `${layout.width} / ${layout.height}`, width: `min(100cqw, calc(100cqh * ${layout.width / layout.height}))` }}>
              {board && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={board} alt="Frame kamu" />
              )}
              {layout.slots.map((slot, i) => {
                const n = i + 1;
                const active = n === current && phase !== 'review';
                const canRetake = phase === 'review' && !!shots[n];
                return (
                  <button
                    key={n}
                    className="slot"
                    data-active={active}
                    data-selected={selected === n}
                    data-filled={!!shots[n]}
                    disabled={!canRetake}
                    onClick={() => tapSlot(n)}
                    style={{
                      left: pct(slot.x, layout.width),
                      top: pct(slot.y, layout.height),
                      width: pct(slot.w, layout.width),
                      height: pct(slot.h, layout.height),
                      transform: slot.angle ? `rotate(${slot.angle}deg)` : undefined,
                    }}
                    aria-label={selected === n ? `Foto ${n} terpilih, klik lagi untuk retake` : shots[n] ? `Pilih foto ${n}` : `Foto ${n}`}
                  >
                    {!shots[n] && <span className="slot-num">{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <div className="g-bar">
        <div style={{ minWidth: 0 }}>
          <div className="g-bar-label">
            {phase === 'review'
              ? selected !== null
                ? `Foto ${selected} terpilih`
                : complete
                  ? 'Semua foto sudah ada'
                  : 'Masih ada foto kosong'
              : `Foto ${shotNumber} dari ${session.shots}`}
          </div>
          <div className="g-bar-value cap2-hint">
            {phase === 'ready'
              ? `${session.shots} pose · 3 detik tiap foto`
              : phase === 'review'
                ? selected !== null
                  ? 'Klik sekali lagi untuk retake'
                  : 'Klik 2 kali pada foto untuk retake'
                : phase === 'finishing'
                  ? 'Menyusun fotomu…'
                  : phase === 'error'
                    ? `Foto ${current} belum tersimpan`
                    : POSES[((current ?? 1) - 1) % POSES.length]}
          </div>
        </div>
        <span className="g-spacer" />
        {failed && <span className="g-error" style={{ padding: '10px 14px' }}>Gagal menyimpan, coba lagi</span>}
        {phase === 'ready' && (
          <button className="g-cta" onClick={() => begin(slots.filter((n) => !shots[n]))} disabled={camera === null || !!cameraProblem}>
            <Camera /> Mulai foto
          </button>
        )}
        {phase === 'error' && current !== null && (
          <button className="g-cta" onClick={() => begin([current, ...queue])}>
            <Retry /> Coba lagi
          </button>
        )}
        {phase === 'review' && !complete && (
          <button className="g-cta" onClick={() => begin(slots.filter((n) => !shots[n]))}>
            <Camera /> Foto yang kosong
          </button>
        )}
        {(phase === 'review' || phase === 'finishing') && complete && (
          <button className="g-cta" onClick={() => void finish()} disabled={phase === 'finishing'}>
            {phase === 'finishing' ? 'Menyimpan…' : 'Lanjut cetak'} <ArrowRight />
          </button>
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
