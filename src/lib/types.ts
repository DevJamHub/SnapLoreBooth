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
}
