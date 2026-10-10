'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GuestHeader from '@/components/guest/GuestHeader';
import { useLang, useT } from '@/components/guest/lang';
import { formatClock, useCountdown } from '@/components/guest/hooks';
import { ArrowRight, Camera, Retry } from '@/components/guest/icons';
import { beep, shutterSound, speak, unlockSound, unlockVoice } from '@/components/guest/sounds';
import { CAMERA_DEVICE_KEY, CAMERA_SOURCE_KEY, readDeviceSetting as readSetting, shutterLagKey } from '@/components/guest/deviceKeys';
import { TETHERED_FPS, useTetheredFeed } from '@/components/guest/useTetheredFeed';
import type { CameraInfo } from '@/lib/camera/types';
import { mediaUrl } from '@/lib/format';
import { readEvents } from '@/lib/readEvents';
import { readJson } from '@/lib/readJson';
import { shotCount, slotOrder } from '@/lib/picks';
import { boardLayout, composeStrip, recorderMimeType } from '@/lib/strip';
import type { CustomFrame, Session } from '@/lib/types';

/** How the photo session runs, from Konsol → Pengaturan. */
export interface CaptureSettings {
  /** Every shot counts down this long, and the live clip records these same seconds. */
  countdown: number;
  /** Beep each second and click on the shutter. */
  sound: boolean;
  /** Read the pose and say the last three seconds, where the device has an Indonesian voice. */
  voice: boolean;
  /** How long each new photo is shown before the next countdown. */
  showMs: number;
  /** The whole photo session; when it ends, missing shots are taken and the guest moves on. */
  sessionSeconds: number;
  retake: boolean;
  prompts: string[];
  /** Record each countdown as video, at this bitrate; null records none. */
  clipBitrate: number | null;
  /** Photos from this device's camera are kept at most this long on their long edge (0: as is). */
  maxEdge: number;
  /** JPEG quality, 0–1. */
  quality: number;
}

const CLIP_UPLOAD_WAIT_MS = 8000;
const DEFAULT_SHUTTER_LAG_MS = 800;
/** With the focus locked there is no autofocus before the shutter. */
const DEFAULT_LOCKED_LAG_MS = 400;
/**
 * A tethered shot is requested up to this long before zero, so its shutter lands near zero.
 * Live view pauses from the request on, so a longer lead would freeze the viewfinder early.
 */
const MAX_LEAD_MS = 1000;

type CaptureEvent = { type: 'fired' } | { type: 'done'; photo?: { file: string } } | { type: 'error'; error?: string };

/** This device's own camera: the server's Canon is neither probed nor woken. */
const DEVICE_CAMERA: CameraInfo = {
  backend: 'browser',
  ready: true,
  model: null,
  port: null,
  serverLiveView: false,
  message: null,
  settings: null,
  choices: null,
  hint: null,
};

type Phase = 'ready' | 'counting' | 'shooting' | 'showing' | 'review' | 'error' | 'finishing';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the voice says on the last seconds; a beep covers any earlier ones. */
const SPOKEN_COUNT: Record<number, string> = { 3: 'tiga', 2: 'dua', 1: 'satu' };
const SPOKEN_COUNT_EN: Record<number, string> = { 3: 'three', 2: 'two', 1: 'one' };
/** A pose is read out only when the countdown leaves time to say it before the numbers. */
const POSE_READ_FROM = 5;

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
  settings,
  showDate,
  qr,
}: {
  session: Session;
  payments: boolean;
  eventName: string;
  initialShots: Record<number, string>;
  /** The uploaded frame the guest chose in Hias; null for a built-in one. */
  frame: CustomFrame | null;
  settings: CaptureSettings;
  showDate: boolean;
  /** The code a built-in frame prints in its footer; null prints none. */
  qr: string | null;
}) {
  const COUNT_FROM = settings.countdown;
  const POSES = settings.prompts;
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const clipChain = useRef<Promise<unknown>>(Promise.resolve());
  const autoFinish = useRef(false);

  const slots = useMemo(() => Array.from({ length: session.shots }, (_, i) => i + 1), [session.shots]);
  /** Every photo to shoot: the sheet's, then any bonus ones to pick the best from. */
  const all = useMemo(() => Array.from({ length: shotCount(session) }, (_, i) => i + 1), [session]);
  const picking = session.bonus > 0;
  const layout = useMemo(
    () => boardLayout(session.format, session.template, session.shots, frame),
    [session.format, session.template, session.shots, frame],
  );

  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Preview and result flip together. Starts as the event's default; the guest can switch it
  // whenever no shot is under way, and every photo on the sheet follows.
  const [mirror, setMirror] = useState(session.mirror);
  const [savingMirror, setSavingMirror] = useState(false);
  const [shots, setShots] = useState<Record<number, string>>(initialShots);
  /** Which photo goes in each hole, in order. Without bonus shots, simply the photos as shot. */
  const [picks, setPicks] = useState<number[]>(() => slotOrder(session));
  const [pickProblem, setPickProblem] = useState(false);
  const [queue, setQueue] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (all.every((n) => initialShots[n]) ? 'review' : 'ready'));
  const [count, setCount] = useState(COUNT_FROM);
  const [flash, setFlash] = useState(false);
  const [snap, setSnap] = useState<string | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  /** Why the last shot failed, in the guest's words. */
  const [shotProblem, setShotProblem] = useState<string | null>(null);
  /** The current shot's shutter has fired; until then a tethered booth says "Tahan!". */
  const [fired, setFired] = useState(false);
  /** The shot whose capture is already under way, so it is never asked for twice. */
  const triggered = useRef<number | null>(null);
  const lagRef = useRef(DEFAULT_SHUTTER_LAG_MS);
  /** First tap on a finished photo selects it (white border); a second tap retakes it. */
  const [selected, setSelected] = useState<number | null>(null);

  // A tethered body streams live view from the server; a webcam or capture card does not.
  const tethered = camera?.serverLiveView === true;
  const complete = all.every((n) => shots[n]);
  const picked = picks.length === session.shots && picks.every((n) => shots[n]);

  useTetheredFeed(liveCanvasRef, tethered && !cameraProblem, camera?.stillAspect ?? null);

  // The tethered viewfinder canvas is what the countdown clips record.
  useEffect(() => {
    const canvas = liveCanvasRef.current;
    if (!tethered || !canvas || typeof canvas.captureStream !== 'function') return;
    const stream = canvas.captureStream(TETHERED_FPS);
    streamRef.current = stream;
    return () => {
      stream.getTracks().forEach((t) => t.stop());
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [tethered]);

  useEffect(() => {
    void fetch(`/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'capturing' }),
    });
  }, [session.id]);

  /** Where this device keeps the lag for the body's current focus mode. */
  const lagKeyRef = useRef(shutterLagKey(false));
  useEffect(() => {
    if (!camera) return;
    lagKeyRef.current = shutterLagKey(camera.focusLocked);
    const lag = Number(readSetting(lagKeyRef.current));
    lagRef.current = Number.isFinite(lag) && lag > 0 ? lag : camera.focusLocked ? DEFAULT_LOCKED_LAG_MS : DEFAULT_SHUTTER_LAG_MS;
  }, [camera]);

  useEffect(() => {
    if (readSetting(CAMERA_SOURCE_KEY) !== 'canon') {
      setCamera(DEVICE_CAMERA);
      return;
    }
    let cancelled = false;
    fetch('/api/camera', { cache: 'no-store' })
      .then((res) => res.json() as Promise<CameraInfo>)
      .then((info) => {
        if (cancelled) return;
        setCamera(info);
        if (info.serverLiveView && !info.ready) setCameraProblem(info.message ?? t('Kamera belum terhubung.'));
      })
      .catch(() => !cancelled && setCameraProblem(t('Booth tidak bisa menghubungi kamera.')));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (camera === null || tethered) return;
    let cancelled = false;
    if (!navigator.mediaDevices) {
      setCameraProblem(t('Kamera hanya bisa dipakai lewat HTTPS.'));
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
      .catch((err: unknown) => !cancelled && setCameraProblem(err instanceof Error ? err.message : t('Akses kamera ditolak.')));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, tethered]);

  // The right-hand sheet fills in shot by shot, in the frame chosen in Hias. The look and
  // beauty come after, on Gaya, so the photos show as shot.
  useEffect(() => {
    let cancelled = false;
    composeStrip(
      slots.map((_, i) => (picks[i] !== undefined ? (shots[picks[i]] ?? null) : null)),
      { format: session.format, filterId: 'original', templateId: session.template, eventName, capturedAt: new Date(session.created_at), frame, mirror, showDate, qr, lang },
      0.75,
    )
      .then((url) => !cancelled && setBoard(url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [shots, picks, slots, session.format, session.template, session.created_at, eventName, frame, mirror, showDate, qr, lang]);

  /** Starts recording the countdown, so every shot also gets its few seconds of video. */
  const startClip = useCallback(() => {
    const stream = streamRef.current;
    const mimeType = recorderMimeType();
    if (!stream || !mimeType || !settings.clipBitrate) return;
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: settings.clipBitrate });
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
  }, [settings.clipBitrate]);

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

  /**
   * Saves what the sensor saw: no mirror, no filter. The look is applied once, on the sheet.
   * A camera bigger than the configured size is scaled down, as the server does for a Canon.
   */
  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const long = Math.max(video.videoWidth, video.videoHeight);
    const scale = settings.maxEdge > 0 && long > settings.maxEdge ? settings.maxEdge / long : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', settings.quality);
  }, [settings.maxEdge, settings.quality]);

  /** Smoothed, so one slow autofocus does not throw the next countdown off. */
  const rememberLag = useCallback((ms: number) => {
    const next = Math.round(lagRef.current * 0.6 + Math.min(ms, 5000) * 0.4);
    lagRef.current = next;
    try {
      localStorage.setItem(lagKeyRef.current, String(next));
    } catch {
      // Private mode: the estimate lasts this page only.
    }
  }, []);

  /** Takes the still; `onFired` runs the moment the shutter fires, with how long that took. */
  const takeStill = useCallback(
    async (index: number, onFired: (lagMs: number) => void): Promise<string> => {
      if (tethered) {
        const started = performance.now();
        const res = await fetch('/api/camera/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, index }),
        });
        if (!res.ok || !res.body) {
          const data = await readJson<object>(res);
          throw new Error(data.error ?? 'capture failed');
        }
        for await (const event of readEvents<CaptureEvent>(res.body)) {
          if (event.type === 'fired') onFired(performance.now() - started);
          else if (event.type === 'error') throw new Error(event.error ?? 'capture failed');
          else if (event.type === 'done' && event.photo) {
            return mediaUrl(event.photo.file, String(Date.now()));
          }
        }
        throw new Error('the camera did not hand over a photo');
      }
      const dataUrl = grabFrame();
      if (!dataUrl) throw new Error('no frame');
      onFired(0);
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
      if (settings.sound) unlockSound();
      if (settings.voice) unlockVoice();
      triggered.current = null;
      setFired(false);
      setSelected(null);
      setCurrent(indices[0]);
      setQueue(indices.slice(1));
      setCount(COUNT_FROM);
      setPhase('counting');
      startClip();
    },
    [startClip],
  );

  /** On to Gaya, where the guest picks the look and beauty and the sheet is made. */
  const finish = useCallback(async () => {
    setPhase('finishing');
    setPickProblem(false);
    if (picking) {
      // A clock that ran out mid-choice fills the empty holes with the photos not yet chosen.
      const chosen = picks.filter((n) => shots[n]).slice(0, session.shots);
      const order = [...chosen, ...all.filter((n) => shots[n] && !chosen.includes(n))].slice(0, session.shots);
      setPicks(order);
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks: order }),
      }).catch(() => null);
      if (!res?.ok) {
        setPickProblem(true);
        setPhase('review');
        return;
      }
    }
    // Give live clips a moment to finish uploading so the QR page has them.
    await Promise.race([clipChain.current, wait(CLIP_UPLOAD_WAIT_MS)]);
    router.push(`/gaya/${session.id}`);
  }, [all, picking, picks, router, session.id, session.shots, shots]);

  /** Tapping a photo in the picker puts it in the next empty hole, or takes it out of its hole. */
  const togglePick = (n: number) => {
    if (phase !== 'review' || !shots[n]) return;
    setSelected(null);
    setPicks((list) => (list.includes(n) ? list.filter((p) => p !== n) : list.length < session.shots ? [...list, n] : list));
  };

  const toggleMirror = async () => {
    const next = !mirror;
    setMirror(next);
    setSavingMirror(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mirror: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Not saved means the print would not match: the screen goes back to what will print.
      setMirror(!next);
    } finally {
      setSavingMirror(false);
    }
  };

  const shoot = useCallback(async () => {
    const index = current;
    if (index === null) return;
    // A tethered body pauses live view to take the still, so its clip ends here.
    const tetheredClip = tethered ? stopClip() : null;
    try {
      const src = await takeStill(index, (lagMs) => {
        // The shutter has just fired: flash now, so guests hold the pose until the real moment.
        setFired(true);
        if (settings.sound) shutterSound();
        setFlash(true);
        setTimeout(() => setFlash(false), 480);
        if (tethered) rememberLag(lagMs);
      });
      // A webcam keeps recording a beat past the shutter: the clip ends on the moment of the photo.
      void (tetheredClip ?? wait(150).then(stopClip)).then((blob) => blob && queueClipUpload(index, blob));
      setShots((prev) => ({ ...prev, [index]: src }));
      setSnap(src);
      setPhase('showing');
      await wait(settings.showMs);
      setSnap(null);

      if (queue.length > 0) {
        begin(queue);
        return;
      }
      setCurrent(null);
      setPhase('review');
    } catch (err) {
      void stopClip();
      // A tethered body that cannot focus refuses to fire; the guest can usually fix that.
      const focus = err instanceof Error && /focus/i.test(err.message);
      setShotProblem(focus ? t('Kamera belum bisa fokus. Mundur sedikit, lalu Coba lagi') : null);
      setPhase('error');
    }
  }, [begin, current, queue, queueClipUpload, rememberLag, stopClip, takeStill, tethered]);

  const shootRef = useRef(shoot);
  shootRef.current = shoot;

  /** Starts the current shot once: from the early tethered request or at zero, whichever is first. */
  const trigger = () => {
    if (current === null || triggered.current === current) return;
    triggered.current = current;
    void shootRef.current();
  };
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  useEffect(() => {
    if (phase !== 'counting') return;
    if (count > 0) {
      const pose = count === COUNT_FROM && COUNT_FROM >= POSE_READ_FROM ? t(POSES[((current ?? 1) - 1) % POSES.length]) : null;
      const numbers = lang === 'en' ? SPOKEN_COUNT_EN : SPOKEN_COUNT;
      const spoken = settings.voice && (pose ? speak(pose, lang) : count in numbers && speak(numbers[count], lang));
      // Higher on the last second, so the guest hears the moment coming.
      if (settings.sound && !spoken) beep(count === 1 ? 1320 : 880);
    }
    if (count <= 0) {
      setPhase('shooting');
      triggerRef.current();
      return;
    }
    const timer = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, count]);

  // A tethered body fires a moment after it is asked, so the request goes out early by the lag
  // measured on earlier shots, and the shutter lands as the countdown reaches zero.
  useEffect(() => {
    if (phase !== 'counting' || !tethered) return;
    const lead = Math.min(Math.max(lagRef.current, 0), MAX_LEAD_MS);
    const timer = setTimeout(() => triggerRef.current(), COUNT_FROM * 1000 - lead);
    return () => clearTimeout(timer);
  }, [phase, current, tethered]);

  // When the session clock runs out, the sheet finishes itself as soon as it is whole.
  useEffect(() => {
    // Not again after a failed save of the picks: the guest presses on themselves then.
    if (phase === 'review' && autoFinish.current && complete && !pickProblem) void finish();
  }, [complete, finish, phase, pickProblem]);

  const onSessionEnd = () => {
    autoFinish.current = true;
    if (phase === 'ready' || phase === 'review' || phase === 'error') {
      const missing = all.filter((n) => !shots[n]);
      if (missing.length > 0) begin(missing);
    }
  };
  const onSessionEndRef = useRef(onSessionEnd);
  onSessionEndRef.current = onSessionEnd;
  const left = useCountdown(settings.sessionSeconds, true, () => onSessionEndRef.current());

  /** A hole on the sheet: the first tap selects its photo, a second retakes that photo. */
  const tapSlot = (hole: number) => {
    const index = picks[hole - 1];
    if (phase !== 'review' || index === undefined || !shots[index] || !settings.retake) return;
    if (selected === index) begin([index]);
    else setSelected(index);
  };

  const shotNumber = current ?? all.find((n) => !shots[n]) ?? session.shots;
  const total = shotCount(session);
  // Uploaded frames can mix photo shapes, so the viewfinder takes the shape of the shot being taken.
  const activeSlot = layout.slots[shotNumber - 1] ?? layout.slots[0];
  const slotAspect = activeSlot.w / activeSlot.h;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <main className="g-screen cap2">
      <GuestHeader step="foto" payments={payments} right={<span className="cap2-clock">{formatClock(left)}</span>} />

      <div className="cap2-body">
        <section className="cap2-camera">
          <button
            className="cap2-mirror"
            aria-pressed={mirror}
            onClick={() => void toggleMirror()}
            disabled={savingMirror || !(phase === 'ready' || phase === 'review' || phase === 'error')}
          >
            <span className="cap2-switch" />
            {t('Mode cermin')}
          </button>
          <div className="fit cq">
            <div className="vf" style={{ aspectRatio: String(slotAspect), width: `min(100cqw, calc(100cqh * ${slotAspect}))` }}>
              {tethered ? (
                <canvas ref={liveCanvasRef} className="vf-feed" style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
              ) : (
                <video ref={videoRef} className="vf-feed" autoPlay playsInline muted style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
              )}
              {phase === 'counting' && count > 0 && (
                <div className="vf-count" aria-live="assertive">
                  <span key={`${current}-${count}`}>{count}</span>
                </div>
              )}
              {tethered && phase === 'shooting' && !fired && (
                <div className="vf-count" aria-live="assertive">
                  <span className="vf-hold">{t('Tahan!')}</span>
                </div>
              )}
              {(phase === 'counting' || (phase === 'shooting' && !tethered)) && <span className="vf-rec">● REC</span>}
              {flash && <div className="cap-flash" />}
              {snap && (
                <div className="vf-snap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={snap} alt={t('Foto {n}', { n: current ?? '' })} style={{ transform: mirror ? 'scaleX(-1)' : undefined }} />
                </div>
              )}
            </div>
          </div>
          {picking && (phase === 'review' || phase === 'finishing') && (
            <div className="pick" role="group" aria-label={t('Pilih foto terbaik')}>
              <p className="pick-head">{t('Pilih {n} foto terbaik · ketuk untuk memilih atau melepas', { n: session.shots })}</p>
              <div className="pick-grid" data-count={total}>
                {all.map((n) => {
                  const hole = picks.indexOf(n);
                  return (
                    <button
                      key={n}
                      className="pick-photo"
                      data-picked={hole >= 0}
                      onClick={() => togglePick(n)}
                      disabled={!shots[n] || phase !== 'review'}
                      aria-label={hole >= 0 ? t('Foto {n}, di tempat {hole}', { n, hole: hole + 1 }) : t('Foto {n}', { n })}
                    >
                      {shots[n] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={shots[n]} alt="" style={{ transform: mirror ? 'scaleX(-1)' : undefined }} draggable={false} />
                      )}
                      <span className="pick-badge">{hole >= 0 ? hole + 1 : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="cap2-sheet">
          <p className="cap2-sheet-hint" data-active={phase === 'review'}>
            {phase === 'review' && settings.retake ? t('Klik 2 kali pada foto untuk retake') : t('Frame kamu')}
          </p>
          <div className="fit cq">
            <div className="sheet" style={{ aspectRatio: `${layout.width} / ${layout.height}`, width: `min(100cqw, calc(100cqh * ${layout.width / layout.height}))` }}>
              {board && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={board} alt="Frame kamu" />
              )}
              {layout.slots.map((slot, i) => {
                const n = i + 1;
                const photo = picks[i];
                const filled = photo !== undefined && !!shots[photo];
                const active = n === current && phase !== 'review';
                const canRetake = phase === 'review' && filled && settings.retake;
                return (
                  <button
                    key={n}
                    className="slot"
                    data-active={active}
                    data-selected={photo !== undefined && selected === photo}
                    data-filled={filled}
                    disabled={!canRetake}
                    onClick={() => tapSlot(n)}
                    style={{
                      left: pct(slot.x, layout.width),
                      top: pct(slot.y, layout.height),
                      width: pct(slot.w, layout.width),
                      height: pct(slot.h, layout.height),
                      transform: slot.angle ? `rotate(${slot.angle}deg)` : undefined,
                    }}
                    aria-label={
                      photo !== undefined && selected === photo ? t('Foto {n} terpilih, klik lagi untuk retake', { n }) : filled ? t('Pilih foto {n}', { n }) : t('Foto {n}', { n })
                    }
                  >
                    {!filled && <span className="slot-num">{n}</span>}
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
                ? t('Foto {n} terpilih', { n: selected })
                : !complete
                  ? t('Masih ada foto kosong')
                  : picking
                    ? t('{n} dari {total} foto dipilih', { n: picks.length, total: session.shots })
                    : t('Semua foto sudah ada')
              : shotNumber > session.shots
                ? t('Foto bonus {n} dari {total}', { n: shotNumber - session.shots, total: session.bonus })
                : t('Foto {n} dari {total}', { n: shotNumber, total })}
          </div>
          <div className="g-bar-value cap2-hint">
            {phase === 'ready'
              ? picking
                ? t('{total} foto, pilih {n} terbaik · {s} detik tiap foto', { total, n: session.shots, s: COUNT_FROM })
                : t('{n} pose · {s} detik tiap foto', { n: session.shots, s: COUNT_FROM })
              : phase === 'review'
                ? picking && complete && !picked
                  ? t('Ketuk foto di kiri untuk mengisi tempat kosong')
                  : !settings.retake
                  ? complete
                    ? t('Lanjut pilih gaya')
                    : t('Foto yang kosong diambil lagi')
                  : selected !== null
                    ? t('Klik sekali lagi untuk retake')
                    : t('Klik 2 kali pada foto untuk retake')
                : phase === 'finishing'
                  ? t('Menyusun fotomu…')
                  : pickProblem
                    ? t('Pilihan belum tersimpan, coba lagi')
                  : phase === 'error'
                    ? (shotProblem ?? t('Foto {n} belum tersimpan', { n: current ?? '' }))
                    : t(POSES[((current ?? 1) - 1) % POSES.length])}
          </div>
        </div>
        <span className="g-spacer" />
        {phase === 'ready' && (
          <button className="g-cta" onClick={() => begin(all.filter((n) => !shots[n]))} disabled={camera === null || !!cameraProblem}>
            <Camera /> {t('Mulai foto')}
          </button>
        )}
        {phase === 'error' && current !== null && (
          <button className="g-cta" onClick={() => begin([current, ...queue])}>
            <Retry /> {t('Coba lagi')}
          </button>
        )}
        {phase === 'review' && !complete && (
          <button className="g-cta" onClick={() => begin(all.filter((n) => !shots[n]))}>
            <Camera /> {t('Foto yang kosong')}
          </button>
        )}
        {(phase === 'review' || phase === 'finishing') && complete && (
          <button className="g-cta" onClick={() => void finish()} disabled={phase === 'finishing' || !picked}>
            {phase === 'finishing' ? t('Menyimpan…') : t('Pilih gaya')} <ArrowRight />
          </button>
        )}
      </div>

      {cameraProblem && (
        <div className="cap-problem">
          <div>
            <h1 className="g-title">{t('Kameranya lagi istirahat sebentar')}</h1>
            <p className="g-lead">{t('Panggil petugas booth ya — sesimu aman dan tidak hilang.')}</p>
            <button
              className="g-cta"
              onClick={() => {
                setCameraProblem(null);
                setCamera(null);
                setReloadKey((k) => k + 1);
              }}
            >
              <Retry /> {t('Coba lagi')}
            </button>
            <p className="mono" style={{ marginTop: 12 }}>{cameraProblem}</p>
            {camera?.serverLiveView && (
              <p className="mono" style={{ marginTop: 8 }}>
                Petugas: nyalakan Canon dan cek kabel USB-nya, lalu Coba lagi. Testing tanpa Canon: Konsol → Kamera → Kamera
                perangkat ini.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
