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
  photo_count: number;
}

export interface Photo {
  id: string;
  session_id: string;
  idx: number;
  file: string;
  created_at: string;
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
