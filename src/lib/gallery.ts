import { galleryItems } from './db';

export interface GalleryItem {
  id: string;
  src: string;
  /** The live sheet, when the booth managed to make one. */
  live: string | null;
  created_at: string;
}

const media = (file: string) => `/api/media/${file.split('/').map(encodeURIComponent).join('/')}`;

export function galleryFor(eventId: string): GalleryItem[] {
  return galleryItems(eventId).map((row) => ({
    id: row.id,
    src: media(row.strip_file),
    live: row.live_file ? media(row.live_file) : null,
    created_at: row.created_at,
  }));
}
