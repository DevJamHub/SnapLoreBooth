import { galleryItems } from './db';
import { mediaUrl } from './format';

export interface GalleryItem {
  id: string;
  src: string;
  /** The live sheet, when the booth managed to make one. */
  live: string | null;
  created_at: string;
}

export function galleryFor(eventId: string): GalleryItem[] {
  return galleryItems(eventId).map((row) => ({
    id: row.id,
    src: mediaUrl(row.strip_file),
    live: row.live_file ? mediaUrl(row.live_file) : null,
    created_at: row.created_at,
  }));
}
