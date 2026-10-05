export type SessionStatus = 'capturing' | 'reviewing' | 'ready' | 'printing' | 'done';

export interface Session {
  id: string;
  created_at: string;
  package_id: string;
  package_label: string;
  format: string;
  shots: number;
  price_idr: number;
  addons: string[];
  status: SessionStatus;
  filter: string;
  template: string;
  prints: number;
  delivered_to: string | null;
  strip_file: string | null;
  /** The whole sheet as video: every slot playing its own countdown clip at once. */
  live_file: string | null;
  photo_count: number;
  event_id: string | null;
  /** Fixed when the session starts, so changing the event's payment mode never strands a guest. */
  requires_payment: boolean;
  in_gallery: boolean;
  /**
   * Photos and clips are stored as the sensor saw them; when true, every place they are shown
   * or composed flips them, so the guest's mirrored preview and the result match. Starts from
   * the event's default; the guest can switch it during the photo session. One value for the
   * whole sheet, so a sheet never mixes the two.
   */
  mirror: boolean;
  /** Skin smoothing chosen on the Gaya screen; see BEAUTY in packages.ts. */
  beauty: string;
}

export interface Photo {
  id: string;
  session_id: string;
  idx: number;
  file: string;
  created_at: string;
  /** A few seconds of video from the countdown before the shot, like a live photo. */
  clip_file: string | null;
}

export interface BoothStatus {
  paper_percent: number;
  prints_today: number;
  prints_remaining: number;
  sessions_today: number;
  /** Sheets loaded at the last recorded refill, or the assumed roll. */
  paper_capacity: number;
  /** When the operator last recorded a refill; null while the count is only an assumption. */
  paper_loaded_at: string | null;
  printer: 'ready' | 'spooling' | 'low_media';
}

export type PaymentStatus = 'pending' | 'paid';

export interface Payment {
  id: string;
  session_id: string;
  amount_idr: number;
  qr_string: string;
  status: PaymentStatus;
  expires_at: string;
  created_at: string;
  paid_at: string | null;
  provider_payment_id: string | null;
}

export type PaymentMode = 'qris' | 'free';
export type PrintMode = 'simulated' | 'airprint';

/** One gig: a wedding, an office party, a weekend at a mall. Settings live here, not in env. */
export interface BoothEvent {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  payment_mode: PaymentMode;
  gallery: boolean;
  print_mode: PrintMode;
  /** Package and add-on id → price in Rupiah; missing ids fall back to the defaults. */
  prices: Record<string, number>;
  /** Set when the operator ends the event; the full photo gallery opens then. */
  ended_at: string | null;
  /** Whether new sessions start mirrored; guests can still switch it. See Session.mirror. */
  mirror: boolean;
}

/**
 * A frame the operator designed elsewhere (Canva, Photoshop) and uploaded as a PNG. It is laid
 * over the photos; its transparent holes are where the photos show through.
 */
export interface CustomFrame {
  id: string;
  name: string;
  /** The package layout it was made for: grid6, grid4, stack3 or single. */
  format: string;
  /** The group guests browse it under, e.g. "Bioskop"; empty when the operator gave none. */
  theme: string;
  /** Kept but not offered to guests (e.g. a wedding theme between weddings). */
  hidden: boolean;
  /** Where each hole sits on the 1200x1800 sheet, in reading order. */
  slots: { x: number; y: number; w: number; h: number; angle?: number }[];
  /** Where a browser loads the PNG from. */
  src: string;
  created_at: string;
}
