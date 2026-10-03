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
  /**
   * Width over height of the stills, when the body reports it. Live view always shows the
   * whole sensor; a body set to 16:9 cuts its stills from the middle, so the kiosk cuts its
   * preview the same way and guests frame exactly what will be taken.
   */
  stillAspect?: number | null;
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

/** What the calibration checklist reads off the body. Null where the body does not say. */
export interface CameraStatus {
  model: string | null;
  battery: string | null;
  /** The exposure dial: "Manual", "AV", "Auto", a scene... */
  mode: string | null;
  aspect: string | null;
  /** Seconds before the body sleeps; "0" means never. */
  autoPowerOff: string | null;
  imageFormat: string | null;
  iso: string | null;
  aperture: string | null;
  shutterspeed: string | null;
}

export interface CaptureOptions {
  /**
   * Fire only once autofocus has locked, and fail if it cannot: the calibration's focus test.
   * Guests are never held to this; their shots fire whether or not focus locked.
   */
  requireFocus?: boolean;
}

export interface CaptureResult {
  /** Path relative to the upload root. */
  file: string;
  bytes: number;
}

export interface CameraSource {
  readonly backend: CameraBackend;
  info(): Promise<CameraInfo>;
  /**
   * Captures one still straight to the upload root and returns its relative path.
   * `onFired` runs the moment the shutter has fired, before the file is downloaded, so the
   * kiosk can flash exactly then; a tethered body fires seconds after it is asked to.
   */
  capture(sessionId: string, index: number, onFired?: () => void, options?: CaptureOptions): Promise<CaptureResult>;
  /** The body's settings for the calibration checklist; backends without a body omit it. */
  status?(): Promise<CameraStatus>;
  /** An MJPEG multipart stream, or null when this backend has no server live view. */
  liveView(signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null>;
  applySettings(patch: Partial<CameraSettings>): Promise<CameraSettings>;
}

export const MJPEG_BOUNDARY = 'snaplorebooth-frame';
