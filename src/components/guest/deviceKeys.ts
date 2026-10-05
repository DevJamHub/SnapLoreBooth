/**
 * Settings each booth device keeps for itself (localStorage). Kept in their own module so the
 * small always-loaded pieces (the heartbeat) need not pull in the capture screen.
 */

/**
 * Remembered per device: how long a tethered body takes from "shoot" to its shutter firing.
 * Calibration in the console measures it; guest shots keep it current.
 */
export const SHUTTER_LAG_KEY = 'snaplorebooth.shutterLagMs';

/**
 * The lag for the body's focus mode: with the focus locked a shot skips autofocus and fires
 * about 0.7 s sooner, so each mode keeps its own measurement and switching does not throw the
 * countdown off.
 */
export const shutterLagKey = (focusLocked?: boolean) => (focusLocked ? `${SHUTTER_LAG_KEY}.locked` : SHUTTER_LAG_KEY);

/** Shared with the operator camera page, which is where these are chosen. */
export const CAMERA_DEVICE_KEY = 'snaplorebooth.cameraDeviceId';
/**
 * Per device: this device's own camera (the default, also when unset), or the Canon on the
 * server. The console sets 'canon' only after it has detected the Canon ready.
 */
export const CAMERA_SOURCE_KEY = 'snaplorebooth.cameraSource';
export type CameraSourceChoice = 'canon' | 'device';

/** One of the settings above; null when unset or when storage is blocked (private mode). */
export function readDeviceSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
