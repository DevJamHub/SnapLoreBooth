/**
 * The booth settings' shape and the choices the console offers. No server imports, so the
 * console's settings screen can use the same lists the API checks against.
 */

/**
 * Everything the operator can tune about how the booth behaves, kept in the settings table as
 * one JSON document. Booth-wide (it is the same booth from gig to gig); what changes per gig —
 * prices, payment, gallery, print mode, mirror default — stays on the event.
 *
 * Reading always yields a complete, valid config: stored values are merged over the defaults
 * and each one checked, so an older or hand-edited document never breaks a guest screen.
 */
export interface BoothConfig {
  standby: {
    /** Small line above the title; empty shows the event name. */
    kicker: string;
    title: string;
    /** The second, italic line of the title. */
    accent: string;
    button: string;
    /** Price, QRIS, print and phone chips along the bottom. */
    chips: boolean;
    /** Holding the logo this long opens the console. */
    holdSeconds: number;
    /** The drifting polaroids show the newest sheets guests let into the gallery. */
    showcase: boolean;
    /** The start button puts the browser full screen (Android tablets have no Guided Access). */
    fullscreen: boolean;
    /** Guests can switch the booth to English. */
    english: boolean;
  };
  packages: {
    /** Package ids guests can pick, in the usual order. */
    enabled: string[];
    extraPrints: boolean;
    maxExtra: number;
  };
  flow: {
    /** Package screen back to standby when untouched. */
    idleSeconds: number;
    hiasSeconds: number;
    /** The guest's camera inside the frame on Hias. */
    livePreview: boolean;
    /** How long one QRIS code stays payable. */
    paymentMinutes: number;
    captureSeconds: number;
    /** Countdown before each shot. */
    countdown: number;
    /** How long each new photo is shown before the next countdown, in tenths of a second. */
    showTenths: number;
    gayaSeconds: number;
    /** Print screen back to standby after printing. */
    shareSeconds: number;
  };
  /** What the built-in frames print under the photos (uploaded frames bring their own). */
  sheet: {
    /** Printed instead of the event name, e.g. a hashtag; empty prints the event name. */
    text: string;
    date: boolean;
    /**
     * Offer the built-in frames (theme Simpel) next to the uploaded ones. A package with no
     * uploaded frame on offer always gets them, so a guest is never left without a frame.
     */
    builtin: boolean;
    /** A QR to the guest's photos and videos, printed in a built-in frame's footer. */
    qr: boolean;
  };
  capture: {
    /** Beeps on the countdown and a shutter sound. */
    sound: boolean;
    /** A voice reads the pose and counts the last three seconds, where the device speaks Indonesian. */
    voice: boolean;
    retake: boolean;
    /** Photos shot beyond the sheet's holes; the guest picks the best for the sheet. */
    bonus: number;
    /** One line per shot, repeating; shown under the countdown. */
    prompts: string[];
    /** Record each countdown as a few seconds of video. */
    clips: boolean;
    videoQuality: VideoQuality;
  };
  style: {
    /** Colour looks offered on Gaya; "original" is always among them. */
    filters: string[];
    defaultFilter: string;
    beauty: boolean;
    defaultBeauty: string;
    /** Stickers, writing and drawing on the sheet, on the Gaya screen. */
    decor: boolean;
    /** AI backdrops behind the guests (on the device, no green screen), on the Gaya screen. */
    backgrounds: boolean;
  };
  share: {
    /** The QR to take the photos home. */
    qr: boolean;
    /** The guest's own switch for the event gallery. */
    galleryChoice: boolean;
    /** Whether a new session shows in the gallery unless the guest says otherwise. */
    galleryDefault: boolean;
    /** The whole sheet as a short video, from the countdown clips. */
    liveVideo: boolean;
    /** A line for the guest on the page the QR opens; empty shows none. */
    message: string;
    /** After printing, offer more sheets paid by QRIS ("Cetak lagi"). */
    upsell: boolean;
    /** The page the QR opens asks (optionally, with consent) for the guest's contact. */
    contacts: boolean;
    /** One question asked with it, e.g. where they heard of the booth; empty asks none. */
    question: string;
    /** The answers offered for it. */
    answers: string[];
    /** The guest can delete their own photos and videos from that page. */
    erase: boolean;
  };
  storage: {
    /** Photos, sheets and the session record are deleted after this. */
    photoHours: number;
    /** Videos may go sooner than the photos: they take most of the space. */
    videoHours: number;
    /** Long edge a camera photo is kept at; 0 keeps the camera's own size. */
    maxEdge: number;
    /** JPEG quality for photos made smaller, 60–95. */
    quality: number;
  };
}

export type VideoQuality = 'hemat' | 'standar' | 'tinggi';

/** Bits per second for a countdown clip and for the whole-sheet video. */
export const VIDEO_BITRATES: Record<VideoQuality, { clip: number; live: number }> = {
  hemat: { clip: 900_000, live: 1_800_000 },
  standar: { clip: 1_600_000, live: 3_000_000 },
  tinggi: { clip: 2_500_000, live: 5_000_000 },
};

export const DEFAULT_PROMPTS = [
  'Senyum paling manis!',
  'Gaya paling heboh!',
  'Saling lihat, terus ketawa',
  'Pose andalan kamu!',
  'Pasang muka kaget!',
  'Rapat-rapat, peluk!',
];

/** Choices the console offers, kept here so the API accepts exactly what the console shows. */
export const CHOICES = {
  countdown: [3, 5, 7, 10],
  holdSeconds: [2, 3, 5],
  retentionHours: [6, 12, 24, 72, 168, 336, 720],
  maxEdge: [0, 3000, 2400, 1800],
  videoQuality: ['hemat', 'standar', 'tinggi'] as VideoQuality[],
  bonus: [0, 1, 2, 4],
};
