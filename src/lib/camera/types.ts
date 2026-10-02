export type CameraBackend = 'browser' | 'gphoto2' | 'folder' | 'simulator';

export interface CameraInfo {
  backend: CameraBackend;
  /** True when the backend can actually capture right now. */
  ready: boolean;
  model: string | null;
  port: string | null;
  /** Whether the browser should render a server live-view stream instead of getUserMedia. */
  serverLiveView: boolean;
  message: string | null;
  settings: CameraSettings | null;
  choices: CameraChoices | null;
  /** Present on macOS when a system process is holding the camera. */
  hint: string | null;
}

export interface CameraSettings {
  iso: string | null;
  aperture: string | null;
  shutterspeed: string | null;
}

export type SettingName = keyof CameraSettings;

/** The values this particular body accepts, read from the camera rather than hardcoded. */
export interface CameraChoices {
  iso: string[];
  aperture: string[];
  shutterspeed: string[];
}

export interface CaptureResult {
  /** Path relative to the upload root. */
  file: string;
  bytes: number;
}

export interface CameraSource {
  readonly backend: CameraBackend;
  info(): Promise<CameraInfo>;
  /** Captures one still straight to the upload root and returns its relative path. */
  capture(sessionId: string, index: number): Promise<CaptureResult>;
  /** An MJPEG multipart stream, or null when this backend has no server live view. */
  liveView(signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null>;
  applySettings(patch: Partial<CameraSettings>): Promise<CameraSettings>;
}

export const MJPEG_BOUNDARY = 'snaplorebooth-frame';
