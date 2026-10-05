'use client';

import { useCallback, useEffect, useState } from 'react';
import BrowserCameraPanel from '@/components/BrowserCameraPanel';
import CameraCalibration, { fireTestShot } from '@/components/CameraCalibration';
import FocusPanel from '@/components/FocusPanel';
import { CAMERA_SOURCE_KEY, type CameraSourceChoice } from '@/components/guest/deviceKeys';
import MirrorPanel from '@/components/MirrorPanel';
import OperatorHeader from '@/components/OperatorHeader';
import type { CameraInfo, CameraSettings } from '@/lib/camera/types';
import { PHONE_UA } from '@/lib/phone';
import { readJson } from '@/lib/readJson';

type TestState = { kind: 'idle' } | { kind: 'firing' } | { kind: 'ok'; src: string; ms: number } | { kind: 'failed'; message: string };

function readChoice(): CameraSourceChoice {
  try {
    return localStorage.getItem(CAMERA_SOURCE_KEY) === 'canon' ? 'canon' : 'device';
  } catch {
    return 'device';
  }
}

function saveChoice(value: CameraSourceChoice) {
  try {
    localStorage.setItem(CAMERA_SOURCE_KEY, value);
  } catch {
    // Blocked storage: the choice holds for this page only.
  }
}

/**
 * Which camera this device's booth screen shoots with. Its own camera is the default; the
 * external Canon is used only once it has been detected ready, and is calibrated here.
 */
export default function CameraConsole({ initialMirror }: { initialMirror: boolean }) {
  const [mirror, setMirror] = useState(initialMirror);
  const [choice, setChoice] = useState<CameraSourceChoice>('device');
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The camera's own words, for whoever has to fix it. */
  const [problemDetail, setProblemDetail] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState<string | null>(null);
  const [liveKey, setLiveKey] = useState(0);
  /** On a phone this page looks after the booth's Canon; the phone itself never shoots. */
  const [phone, setPhone] = useState(false);

  /** Asks the server for the external camera. Only a body that answers ready is returned. */
  const detect = useCallback(async (): Promise<CameraInfo | null> => {
    setDetecting(true);
    setProblem(null);
    setProblemDetail(null);
    try {
      const res = await fetch('/api/camera', { cache: 'no-store' });
      const data = await readJson<CameraInfo>(res);
      if (data.error) throw new Error(data.error);
      if (!data.serverLiveView) {
        setInfo(null);
        setProblem('Server ini belum bisa memakai kamera eksternal: gphoto2 belum terpasang (brew install gphoto2), lalu restart server.');
        return null;
      }
      setInfo(data);
      if (!data.ready) {
        setProblem(
          data.model
            ? `${data.model} terdeteksi tapi belum bisa dipakai.`
            : 'Canon tidak terdeteksi. Nyalakan Canon (tekan rana setengah kalau sedang tidur), cek kabel USB ke server, lalu deteksi lagi.',
        );
        setProblemDetail(data.message);
        return null;
      }
      return data;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Server tidak menjawab.');
      return null;
    } finally {
      setDetecting(false);
    }
  }, []);

  // A device already set to the Canon checks it is still there.
  useEffect(() => {
    if (PHONE_UA.test(navigator.userAgent)) {
      setPhone(true);
      setChoice('canon');
      void detect();
      return;
    }
    const saved = readChoice();
    setChoice(saved);
    if (saved === 'canon') void detect();
  }, [detect]);

  const chooseDevice = () => {
    setChoice('device');
    saveChoice('device');
    setProblem(null);
    setProblemDetail(null);
    setTest({ kind: 'idle' });
  };

  /** Detect first; switch this device to the Canon only if it answered ready. */
  const chooseCanon = async () => {
    if (await detect()) {
      setChoice('canon');
      saveChoice('canon');
    }
  };

  const setSetting = async (name: keyof CameraSettings, value: string) => {
    setSaving(name);
    try {
      const res = await fetch('/api/camera/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [name]: value }),
      });
      const data = await readJson<{ settings?: CameraSettings }>(res);
      if (data.settings && info) setInfo({ ...info, settings: data.settings });
    } finally {
      setSaving(null);
    }
  };

  const fireTest = async () => {
    setTest({ kind: 'firing' });
    try {
      const shot = await fireTestShot();
      setTest({ kind: 'ok', src: shot.src, ms: Math.round(shot.lagMs) });
    } catch (err) {
      setTest({ kind: 'failed', message: err instanceof Error ? err.message : 'capture failed' });
    }
  };

  const canon = choice === 'canon' && info?.ready === true;

  return (
    <main className="op">
      <OperatorHeader active="kamera" />

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <span className="mono">{phone ? 'KAMERA EKSTERNAL BOOTH' : 'KAMERA BOOTH DI PERANGKAT INI'}</span>
        {phone ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Dari HP kamu bisa cek, kalibrasi, dan test shot Canon yang tersambung ke server. Kamera yang dipakai layar booth
            diatur di perangkat booth itu sendiri.
          </p>
        ) : (
          <>
            <div className="segmented">
              <button aria-pressed={choice === 'device'} onClick={chooseDevice}>
                Kamera perangkat ini
              </button>
              <button aria-pressed={choice === 'canon'} onClick={() => void chooseCanon()} disabled={detecting}>
                {detecting ? 'Mendeteksi Canon…' : 'Canon (USB)'}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {choice === 'device'
                ? 'Default: booth memakai kamera perangkat ini (MacBook, iPad, atau capture card). Canon tidak disentuh. Pilih Canon (USB) untuk mendeteksi dan memakainya.'
                : 'Booth di perangkat ini memotret dengan Canon yang tersambung ke server. Kalibrasi sebelum acara.'}
            </p>
          </>
        )}
        {problem && (
          <div className="notice notice-error" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>{problem}</span>
            {problemDetail && <span className="mono mono-sm">{problemDetail}</span>}
            {info?.hint && <span>{info.hint}</span>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="pill pill-ghost pill-sm" onClick={() => void (choice === 'canon' ? detect() : chooseCanon())} disabled={detecting}>
                Deteksi lagi
              </button>
              {choice === 'canon' && !phone && (
                <button className="pill pill-ghost pill-sm" onClick={chooseDevice}>
                  Pakai kamera perangkat ini
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="kiosk-body">
        {choice === 'device' && (
          <section className="col-main">
            <MirrorPanel mirror={mirror} onChange={setMirror} />
            <BrowserCameraPanel mirror={mirror} />
          </section>
        )}

        {canon && info && (
          <>
            <section className="col-main">
              <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span className="status-item">
                  <i className="dot dot-ok" />
                  <span className="mono">TERHUBUNG · {info.port}</span>
                </span>
                <h3>{info.model}</h3>
              </div>
              <div className="viewfinder">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={liveKey}
                  src={`/api/camera/liveview?k=${liveKey}`}
                  alt="Live view"
                  style={{ transform: mirror ? 'scaleX(-1)' : undefined }}
                />
              </div>
              <button className="pill pill-ghost" onClick={() => setLiveKey((k) => k + 1)}>
                Muat ulang live view
              </button>
            </section>

            <section className="col-deck scroll">
              <CameraCalibration />
              <FocusPanel locked={info.focusLocked === true} onChange={(focusLocked) => setInfo({ ...info, focusLocked })} />
              <MirrorPanel mirror={mirror} onChange={setMirror} />

              <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span className="mono">EKSPOSUR DI KAMERA</span>
                {(['iso', 'aperture', 'shutterspeed'] as const).map((name) => {
                  const options = info.choices?.[name] ?? [];
                  const current = info.settings?.[name] ?? '';
                  return (
                    <label key={name} className="field-label">
                      <span className="mono mono-sm">{{ iso: 'ISO', aperture: 'BUKAAN (F)', shutterspeed: 'RANA' }[name]}</span>
                      {options.length > 0 ? (
                        <select className="field" value={current} disabled={saving === name} onChange={(e) => setSetting(name, e.target.value)}>
                          {!options.includes(current) && current && <option value={current}>{current}</option>}
                          {options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="field" value={current} disabled readOnly placeholder="—" />
                      )}
                    </label>
                  );
                })}
                {!info.choices?.iso.length && (
                  <p className="muted" style={{ fontSize: 13 }}>Kamera tidak memberi pilihan dari sini: atur langsung di kamera (kenop M).</p>
                )}
              </div>

              <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span className="mono">TEST SHOT</span>
                <button className="pill pill-ghost" onClick={fireTest} disabled={test.kind === 'firing'}>
                  {test.kind === 'firing' ? 'Memotret…' : 'Potret sekali'}
                </button>
                {test.kind === 'ok' && (
                  <>
                    <span className="mono">RANA MEMBUKA {test.ms} MS SETELAH DIMINTA</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={test.src} alt="Test shot" style={{ width: '100%', borderRadius: 12 }} />
                  </>
                )}
                {test.kind === 'failed' && <div className="notice notice-error">{test.message}</div>}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
