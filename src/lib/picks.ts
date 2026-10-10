/**
 * Bonus shots: a guest may shoot a few more photos than the sheet holds and pick the best for
 * it. Photos keep the number they were shot as (and their file name); the session only records
 * which photo goes in which hole. No server imports, so the capture screen shares it.
 */
export interface Picked {
  shots: number;
  bonus: number;
  picks: number[] | null;
}

/** The photo number in each hole, in order: the guest's picks, else the first ones shot. */
export function slotOrder(session: Picked): number[] {
  return session.picks && session.picks.length === session.shots ? session.picks : Array.from({ length: session.shots }, (_, i) => i + 1);
}

/** Every photo number the session shoots: the sheet's and the bonus ones. */
export function shotCount(session: Pick<Picked, 'shots' | 'bonus'>): number {
  return session.shots + session.bonus;
}

/** A pick list the session can use: one distinct, shot photo per hole. Null when it is not one. */
export function validPicks(value: unknown, session: Pick<Picked, 'shots' | 'bonus'>, shot: Set<number>): number[] | null {
  if (!Array.isArray(value) || value.length !== session.shots) return null;
  const picks = value.map(Number);
  if (picks.some((n) => !Number.isInteger(n) || n < 1 || n > shotCount(session) || !shot.has(n))) return null;
  return new Set(picks).size === picks.length ? picks : null;
}
