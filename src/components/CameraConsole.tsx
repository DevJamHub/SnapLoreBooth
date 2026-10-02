'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CameraInfo, CameraSettings } from '@/lib/camera/types';

type TestState = { kind: 'idle' } | { kind: 'firing' } | { kind: 'ok'; src: string; ms: number } | { kind: 'failed'; message: string };

export default function CameraConsole() {
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState<string | null>(null);
  const [liveKey, setLiveKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/camera', { cache: 'no-store' });
      setInfo((await res.json()) as CameraInfo);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setSetting = async (name: keyof CameraSettings, value: string) => {
    setSaving(name);
    try {
      const res = await fetch('/api/camera/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [name]: value }),
      });
      const data = (await res.json()) as { settings?: CameraSettings; error?: string };
      if (data.settings && info) setInfo({ ...info, settings: data.settings });
    } finally {
      setSaving(null);
    }
  };

  const fireTest = async () => {
    setTest({ kind: 'firing' });
    const started = performance.now();
    try {
      const res = await fetch('/api/camera/test', { method: 'POST' });
      const data = (await res.json()) as { file?: string; ms?: number; error?: string };
      if (!res.ok || !data.file) throw new Error(data.error ?? 'the camera did not return a frame');
      setTest({
        kind: 'ok',
        src: `/api/media/${data.file.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`,
        ms: data.ms ?? Math.round(performance.now() - started),
      });
    } catch (err) {
      setTest({ kind: 'failed', message: err instanceof Error ? err.message : 'capture failed' });
    }
  };

  const dot = info?.ready ? 'dot dot-ok' : 'dot dot-bad';

  return (
    <main className="kiosk">
      <div className="topbar">
        <div className="brand">
          <strong>Camera</strong>
          <span className="mono">TETHER DIAGNOSTICS</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="pill pill-ghost pill-sm" onClick={load} disabled={loading}>
            {loading ? 'Checking…' : 'Re-detect'}
          </button>
          <Link className="pill pill-ghost pill-sm" href="/operator" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Sessions
          </Link>
        </div>
      </div>

      <div className="kiosk-body">
        <section className="col-main">
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span className="status-item">
              <i className={dot} />
              <span className="mono">
                {info ? `${info.backend.toUpperCase()} · ${info.ready ? 'READY' : 'NOT READY'}` : 'CHECKING…'}
              </span>
            </span>
            <h3>{info?.model ?? 'No body detected'}</h3>
            <span className="mono">{info?.port ?? 'NO PORT'}</span>
            {info?.message && <div className="notice">{info.message}</div>}
            {info?.hint && <div className="notice notice-error">{info.hint}</div>}
            {info && !info.serverLiveView && (
              <p className="muted" style={{ fontSize: 14 }}>
                This booth is set to <code>CAMERA_SOURCE=browser</code>, so capture happens in the tablet. Restart
                with <code>CAMERA_SOURCE=gphoto2</code> to drive a tethered body.
              </p>
            )}
          </div>

          {info?.serverLiveView && (
            <div className="viewfinder">
              {info.ready ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={liveKey} src={`/api/camera/liveview?k=${liveKey}`} alt="Live view" />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <h3>No live view</h3>
                  <p className="muted" style={{ marginTop: 8 }}>Connect the body, then re-detect.</p>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="col-deck scroll">
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span className="mono">EXPOSURE ON THE BODY</span>
            {(['iso', 'aperture', 'shutterspeed'] as const).map((name) => {
              const options = info?.choices?.[name] ?? [];
              const current = info?.settings?.[name] ?? '';
              return (
                <label key={name} className="field-label">
                  <span className="mono mono-sm">{name.toUpperCase()}</span>
                  {options.length > 0 ? (
                    <select
                      className="field"
                      value={current}
                      disabled={!info?.ready || saving === name}
                      onChange={(e) => setSetting(name, e.target.value)}
                    >
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
            {info?.ready && !info.choices?.iso.length && (
              <p className="mono mono-sm">THIS BODY DID NOT ADVERTISE CHOICES — SET EXPOSURE ON THE CAMERA ITSELF</p>
            )}
          </div>

          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span className="mono">TEST SHOT</span>
            <p className="muted" style={{ fontSize: 14 }}>
              Fires the shutter once and times it end to end. Use the number to tune the countdown before doors open.
            </p>
            <button className="pill" onClick={fireTest} disabled={!info?.ready || test.kind === 'firing'}>
              {test.kind === 'firing' ? 'Firing…' : 'Fire test shot'}
            </button>
            {test.kind === 'ok' && (
              <>
                <span className="mono">CAPTURED IN {test.ms} ms</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={test.src} alt="Test shot" style={{ width: '100%', borderRadius: 12 }} />
                {test.ms > 3000 && (
                  <div className="notice">
                    Slower than the 4s countdown allows for. Raise the countdown or guests will move before the
                    shutter fires.
                  </div>
                )}
              </>
            )}
            {test.kind === 'failed' && <div className="notice notice-error">{test.message}</div>}
          </div>

          {info?.serverLiveView && info.ready && (
            <button className="pill pill-ghost" onClick={() => setLiveKey((k) => k + 1)}>
              Restart live view
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
