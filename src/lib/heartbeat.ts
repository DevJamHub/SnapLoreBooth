/**
 * What each booth screen last said about itself. Kept in memory: it only matters while the
 * server runs, and a restart forgets nothing the next beat (30 s) does not bring back.
 */
export interface BoothBeat {
  id: string;
  /** "iPad", "Mac", "Android tablet"… */
  device: string;
  /** The guest step on screen: Standby, Pilih paket, Hias, Bayar, Foto, Cetak. */
  page: string;
  session: string | null;
  camera: string;
  screen: string;
  /** 0–100 where the browser tells (Chrome); Safari keeps it private. */
  battery: number | null;
  charging: boolean | null;
  seenAt: number;
}

/** A booth that misses two beats is offline. */
export const ONLINE_WITHIN_MS = 75_000;
const FORGET_AFTER_MS = 12 * 3600_000;
const MAX_DEVICES = 20;

const store = (globalThis as unknown as { __boothBeats?: Map<string, BoothBeat> }).__boothBeats ?? new Map<string, BoothBeat>();
(globalThis as unknown as { __boothBeats?: Map<string, BoothBeat> }).__boothBeats = store;

export function recordBeat(beat: BoothBeat) {
  const now = Date.now();
  for (const [id, b] of store) if (now - b.seenAt > FORGET_AFTER_MS) store.delete(id);
  store.set(beat.id, beat);
  // The endpoint is open to the kiosk; a flood can only ever push out the oldest entries.
  while (store.size > MAX_DEVICES) {
    const oldest = [...store.values()].sort((a, b) => a.seenAt - b.seenAt)[0];
    store.delete(oldest.id);
  }
}

export function boothDevices(): (BoothBeat & { online: boolean })[] {
  const now = Date.now();
  return [...store.values()].sort((a, b) => b.seenAt - a.seenAt).map((b) => ({ ...b, online: now - b.seenAt <= ONLINE_WITHIN_MS }));
}
