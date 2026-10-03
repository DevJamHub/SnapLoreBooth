import { existsSync } from 'node:fs';
import { FolderCamera } from './folder';
import { Gphoto2Camera } from './gphoto2';
import { SimulatorCamera } from './simulator';
import type { CameraBackend, CameraInfo, CameraSource } from './types';

/** Where Homebrew, Linux packages and a custom build put gphoto2. */
const GPHOTO2_PATHS = [process.env.GPHOTO2_BIN, '/opt/homebrew/bin/gphoto2', '/usr/local/bin/gphoto2', '/usr/bin/gphoto2'];

/**
 * Unset, the server offers a tethered Canon whenever gphoto2 is installed. Offering is all it
 * does: each device shoots with its own camera until the operator detects the Canon and picks
 * it in Konsol → Kamera. A VPS without gphoto2 stays browser-only.
 */
const CONFIGURED = (process.env.CAMERA_SOURCE ??
  (GPHOTO2_PATHS.some((p) => p && existsSync(p)) ? 'gphoto2' : 'browser')) as CameraBackend;

const globalForCamera = globalThis as unknown as { __boothCamera?: CameraSource };

function build(): CameraSource | null {
  if (CONFIGURED === 'gphoto2') return new Gphoto2Camera();
  if (CONFIGURED === 'folder') return new FolderCamera();
  if (CONFIGURED === 'simulator') return new SimulatorCamera();
  return null; // 'browser' — the tablet's own webcam, handled client-side.
}

/** The configured server-side camera, or null when the browser owns capture. */
export function camera(): CameraSource | null {
  if (CONFIGURED === 'browser') return null;
  if (!globalForCamera.__boothCamera) globalForCamera.__boothCamera = build()!;
  return globalForCamera.__boothCamera;
}

export const browserInfo: CameraInfo = {
  backend: 'browser',
  ready: true,
  model: 'Tablet webcam (getUserMedia)',
  port: null,
  serverLiveView: false,
  message: null,
  settings: null,
  choices: null,
  hint: null,
};

export { CONFIGURED as configuredBackend };
export type { CameraInfo, CameraSource } from './types';
