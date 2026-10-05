/** Small formatters shared by server pages and client screens; nothing here touches the server. */

/** Where the browser loads a stored file (see /api/media). `version` busts the cache after a retake. */
export function mediaUrl(file: string, version?: string): string {
  const url = `/api/media/${file.split('/').map(encodeURIComponent).join('/')}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

export function formatBytes(n: number): string {
  if (n < 1e3) return `${n} B`;
  if (n < 1e6) return `${Math.round(n / 1e3)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/** "7 hari" for whole days from two days up, else "36 jam". */
export function formatRetention(hours: number): string {
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} hari` : `${hours} jam`;
}
