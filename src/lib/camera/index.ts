import { FolderCamera } from './folder';
import { Gphoto2Camera } from './gphoto2';
import { SimulatorCamera } from './simulator';
import type { CameraBackend, CameraInfo, CameraSource } from './types';

const CONFIGURED = (process.env.CAMERA_SOURCE ?? 'browser') as CameraBackend;

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
