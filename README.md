# SnaploreBooth

A tablet photobooth kiosk — guests pick a format, pay by QRIS, the booth counts them down
through every pose on its own, they choose a look and a frame, and it prints the board and
hands it over by QR. Built for a 10–13" iPad in landscape on a booth stand, with a hidden
operator console on the same server. Guest screens are in Indonesian.

Visual language follows the **Warm Editorial Tablet Studio** design system
(Stitch asset `481f2491f6e546c8a61d82fb602eb6d4`): warm charcoal surfaces, terracotta
`#CC785C` actions, Newsreader headlines, Plus Jakarta Sans body, JetBrains Mono telemetry,
48px minimum touch targets.

## Stack

- **Next.js 15** (App Router, React 19, TypeScript) — pages and API routes in one server
- **SQLite** via `better-sqlite3` — sessions, photos, delivery records
- **Local filesystem** (`data/uploads/<sessionId>/`) — captured frames and composed boards
- **`qrcode`** — the take-home QR rendered server-side
- No CSS framework: design tokens live in `src/app/globals.css`

## Run it

```bash
npm install
npm run dev      # http://localhost:4300
```

Production: `npm run build && npm start`.

The camera needs a secure context. `localhost` counts, so the kiosk works during local
development; on a real booth serve it over HTTPS or the browser will refuse `getUserMedia`.

## Guest flow

Guest screens carry no telemetry, session ids or camera jargon: one decision per screen, big
touch targets, and a step indicator (Pilih → Hias → Bayar → Foto → Gaya → Cetak; *Bayar*
disappears when the event is free). Every screen finds its own way back to standby, and on standby only
the *Sentuh untuk mulai* button starts a session.

| Route | What happens | Clock |
| --- | --- | --- |
| `/` | Standby: drifting polaroids and one start button | — |
| `/paket` | 6 / 4 / 3 poses or one portrait, all on **one uncut 4R sheet**; a stepper adds extra sheets (+1 cetak) | back to standby after 60s untouched |
| `/hias/[id]` | Pick the frame, browsed by theme (Bioskop, Romance, … then the built-in *Simpel*), with the guest live in every hole of it. *Ganti paket* goes back and discards the still-empty session | 5 minutes, then continues with what is selected |
| `/pay/[id]` | QRIS from Xendit; moves on by itself once paid. *Batal* asks first while a code is live | back to standby 45s after the code expires |
| `/capture/[id]` | Camera on the left, the sheet filling in on the right. 3-second countdown per shot; afterwards tap any photo on the sheet to retake it. *Mode cermin* switch on the camera | 10 minutes, then missing shots are taken and the guest moves on |
| `/gaya/[id]` | The guest's own photos in the frame: pick the colour look and **beauty** (Mati / Natural / Glowing). Hold the preview to see the original. The sheet is made here | 2 minutes, then prints with what is selected |
| `/share/[id]` | Print (simulated or AirPrint), QR to save to a phone, opt out of the live gallery | 45s after printing; 3 min if never printed |
| `/d/[id]` | What the QR opens: the sheet, every photo, and every **live clip** | — |
| `/g/[slug]` | The event link: rotating live sheets while it runs, the photo gallery once it ends | — |

The clocks are the defaults; *Konsol → Pengaturan* changes them, along with the countdown,
prompts, packages offered, looks, beauty, sounds and more (see *Settings* below).

The viewfinder takes the exact shape of a photo slot on the chosen sheet, so what the guest
frames is what prints. Stills are saved as the sensor saw them — not mirrored, not filtered,
not smoothed; the look and beauty are applied once, when the sheet is composed on *Gaya*.

**Beauty** (`applyBeauty()` in `src/lib/beauty.ts`, levels in `BEAUTY` in
`src/lib/packages.ts`) smooths and brightens skin only: a soft YCbCr skin mask, a blur of each
photo at its slot size, and an edge gate, so eyes, brows, lips, hair and the background stay
sharp. It runs in the browser on each cut photo and is cached while the guest tries looks, so
switching looks is instant. The printed sheet and the QR download have it; the live video
sheet gets the colour look only. Filters are plain colour operations
(`FILTERS` in `src/lib/packages.ts`) applied with `ctx.filter` where the browser supports it
and pixel by pixel where it does not (Safari before 18). Frames are `TEMPLATES` in the same
file; adding an entry to either list adds it to every screen.

**Live clips.** Every shot also records its 3-second countdown (and a beat past the shutter)
with `MediaRecorder` — MP4 on Safari, MP4 or WebM on Chrome — and uploads it to
`POST /api/sessions/[id]/clips?index=n`. A retake replaces the clip with the still. The
download page plays them on a loop, silently, like GIFs. A tethered body has no clips.

**Live sheet.** While the printer works, the print screen records one more video: the whole
sheet in its frame, colour look and event name, with every slot playing its own clip at the
same time (`composeLive()` in `src/lib/strip.ts`, an 800x1200 canvas captured with
`MediaRecorder`). It replaces the still on the print screen, leads the QR page — which waits
for it if the guest scans first — and plays in the gallery's TV mode. *Selesai* waits the few
seconds it takes. Without canvas filter support (Safari before 18) the live sheet skips the
colour look; the printed sheet always has it.

Layouts live in `boardLayout()` in `src/lib/strip.ts`: every package is a 1200x1800 board
(4x6in at 300dpi), and old 2x6 strips still render for sessions made before.

## Events: one gig, one set of settings

Everything that changes from gig to gig lives on an **event**, edited in the operator
console — no code or env edits on the day:

| Setting | Options |
| --- | --- |
| Name | Printed under the photos and shown on standby and the gallery |
| Guest payment | **QRIS** (guests pay) or **Gratis** (the host paid for the rental) |
| Printing | **Simulasi** or **AirPrint** (see below) |
| Prices | Per package and add-on; 0 makes it free. Paid packages start at Rp1.500, the QRIS minimum |
| Event link | On/off. Second screen while running, photo gallery once ended |

*Mulai acara baru* starts the next gig: new sessions join it, it gets its own gallery link,
and it inherits the previous event's prices and modes. A session keeps the payment rule it
started under, so switching a running event to *Gratis* never strands a guest mid-payment.
`PAYMENT=off` in the environment still overrides every event, for rehearsals.

```bash
PUBLIC_BASE_URL=https://booth.example.com   # where QR codes point; see below when unset
EVENT_NAME="SnaploreBooth"                  # only names the very first event on a fresh booth
```

Without `PUBLIC_BASE_URL`, a screen opened at `localhost` or a LAN address puts the running
`npm run tunnel` address in its QR codes (read from cloudflared's metrics server,
`127.0.0.1:20241/quicktunnel`, every 15 s), else the address in use. So the booth screen can
run at `http://localhost:4300` (or `http://<Mac's Wi-Fi IP>:4300` on the iPad) while guests'
phones still get a link that works off the venue network. *Sistem → Alamat publik* shows which.

## Event link: second screen during, gallery after

`/g/<slug>` is one link with two faces, chosen by the event's state:

- **While the event runs** it is the venue's second screen: three guests' live sheets side by
  side (one on a phone), looping, fading every 9 seconds to the next three and wrapping round
  to the first guest when everyone has had a turn. A guest who just finished jumps into the
  next group with a *Baru* tag. The header carries the guest count and a QR to the link.
- **When the operator ends the event** (*Akhiri acara* in the console, or by starting the
  next event) every screen on the link switches by itself, within 5 seconds, to the photo
  gallery: every sheet, each opening to its live sheet with photo and video downloads.
  *Buka lagi* reopens an event ended by mistake.

Guests can keep their own photo off the link from the print screen. The slug ends in random
characters so the link cannot be guessed from the event name.

## Settings (Konsol → Pengaturan)

Everything about how the booth behaves, booth-wide, at `/operator/pengaturan`; what changes
per gig (prices, payment, gallery, print mode, mirror default) stays on the event. Changes are
drafted and saved together (a bar appears while unsaved; leaving asks first); guest screens
use them from their next page. *Kembalikan ke bawaan* restores the defaults behind a
confirmation. Stored as one JSON document in the `settings` table (`src/lib/config.ts`;
the shape and choices in `src/lib/configShared.ts`), merged over the defaults and validated
field by field, so an old or hand-edited document never breaks a guest screen and the API
refuses what the console would not offer.

| Section | Settings |
| --- | --- |
| Layar awal | Small line, title (two lines), start button text, info chips, how long to hold the logo for the console |
| Paket & cetak | Which packages are offered, extra prints on/off and their maximum, the text the built-in frames print (e.g. a hashtag instead of the event name) and whether they print the date |
| Alur & waktu | Package screen idle, Hias time, live camera on Hias, QRIS validity, photo session length, Gaya time, print screen time |
| Foto & pose | Countdown beeps and shutter sound, countdown (3/5/7/10 s), how long each photo shows, retakes on/off, the pose prompts (one per line), per-shot video on/off and its quality (Hemat / Standar / Tinggi) |
| Gaya & beauty | Which colour looks are offered and which is preselected, beauty on/off and its preselected level. With only *Asli* and no beauty the Gaya screen makes the sheet and moves on by itself |
| Berbagi & galeri | QR on the print screen, sessions join the gallery unasked, the guest's own gallery switch, the whole-sheet video, a message on the QR page |
| Penyimpanan | How long photos and (separately) videos are kept, the size camera photos are kept at, JPEG quality, disk use by kind, *Optimalkan sekarang* |

## Reports (Konsol → Laporan)

`/operator/laporan` over today, 7 days, 30 days, the running event, or everything: revenue,
sessions and how many reached a print, average per paying guest, payment rate (paid against
abandoned at QRIS), sheets printed, revenue per day, busy hours, sessions and revenue per
package, and the favourite frames, looks and beauty levels. *Unduh CSV* exports the range's
sessions for Excel or Sheets; *Unduh foto acara* streams the running event's finished sheets
(or every photo and video, a folder per session) as a ZIP for the client. Past events have a
ZIP link in *Acara sebelumnya*. *Sistem → Cadangan & ekspor* downloads a consistent copy of
the database (`better-sqlite3`'s online backup) to keep off the booth laptop.

## Phones get the console

The booth runs on tablets, laptops and PCs. A phone (iPhone, Android phone) that opens a booth
screen is sent to `/operator` instead, behind the same password: the owner or an employee
watching the booth. Tablets are never caught (iPadOS reports itself as a Mac; Android tablets
leave "Mobile" out). Guests' phones still reach `/d/…` (their photos) and `/g/…` (the event
gallery). On a phone the console pages switch to a bottom tab bar and the Ringkasan page
refreshes itself every 15 seconds while it is on screen.

What the console watches:

- **Booth screens.** Every guest screen reports every 30 s (`POST /api/booth/heartbeat`):
  device, current step and session, camera in use, battery where the browser tells (Chrome;
  Safari does not). Two missed beats is offline. Kept in memory only.
- **Printer.** *Printer & kertas → Cari printer* lists AirPrint printers on the Wi-Fi
  (`ippfind`) and printers set up on the server (`lpstat`); the chosen one is read over IPP
  (`ipptool get-printer-attributes`): state, problems (paper out, jam, cover open, ink low,
  offline) and ink levels when the printer reports them. Refillable-tank printers such as the
  Epson L8050 often report estimates or nothing.
- **Paper.** *Catat isi ulang* records how many sheets were loaded; the count runs down by the
  sheets printed since then (until a refill is recorded, it is an estimate).
- **Sistem** (developer mode): server, database, disk space, R2, Xendit mode (never the key),
  webhook, camera and printer tooling, booth screens in detail, and the raw JSON endpoints.

## Mirror

On by default: guests see themselves as in a mirror, and the print is flipped the same way.
The guest can switch it with *Mode cermin* on the photo screen (between shots, before the
sheet is made); the preview and the result always flip together, for every photo on the
sheet. *Konsol → Kamera → Mode cermin · awal sesi* sets what new sessions start with. Files
are always stored as the sensor saw them, and a session records whether it is mirrored, so
the sheet, the live sheet, and the per-photo views on the QR page flip them. The individual
photo and clip downloads on the QR page are the stored, unflipped files.

## Custom frames

Besides the built-in frames, the operator can upload their own design at **Konsol → Frame**
(`/operator/frame`). A design is a 4R portrait image, 1200 × 1800 px, PNG or JPG, that marks
where the photos go in one of two ways:

- **Green boxes**: solid `#00FF00` rectangles. Free Canva can export these; the console keys
  the green out (anti-aliased rims included) and stores a PNG with transparent holes.
- **Transparent holes**: a PNG exported with a transparent background (Canva Pro,
  Photoshop, Photopea).

The holes can sit anywhere, at any size, tilted, or be non-rectangular (a circle gets its
bounding box; the design masks the rest). The console traces them, numbers them in reading
order, picks the package with that many photos (6, 4, 3 or 1) and shows a preview before
saving. Each tilted photo is rotated to match its hole, on the print and in the live video.
A design with a different number of holes, or the wrong shape, is refused with the reason.

*Panduan ukuran* downloads a starting sheet per package with green boxes in the default
positions, to use as the background in Canva. Uploaded frames are stored in `data/frames`.

**Themes.** Each frame gets a theme at upload (*Bioskop*, *Romance*, …; typed or picked from
the ones in use, matched case-insensitively). Guests browse themes as tabs on the Hias screen,
in the order the operator made them, with that theme's frames for their package; the
built-in frames sit last under *Simpel*, frames without a theme under *Lainnya*. *Ubah* on a
saved frame renames it or moves it to another theme. *Tampil ke tamu* on a frame, or
*Sembunyikan tema* on a whole theme (asked first), keeps frames without offering them — a
wedding theme between weddings. *Pengaturan → Tawarkan bingkai bawaan* can drop *Simpel*;
a package with no uploaded frame on offer still gets it, so no guest is left without a frame.

The design prints its own text, so the event name and date are not added. Deleting a frame
(behind a confirmation) leaves sheets already made with it untouched.

## Printing: AirPrint to a Canon SELPHY

With the event's printing set to **AirPrint**, the last screen shows *Cetak*: it opens the
iPad's print sheet with one page per sheet paid for, each a full 4x6in board. Pick the SELPHY
(CP1300/CP1500 support AirPrint) once; iOS remembers it. Safari always shows the print sheet
— printing with no dialog at all needs the native app wrapper, which is not built yet.
*Simulasi* keeps the timed progress bar for rehearsals without a printer.

## Photo backup to Cloudflare R2 (optional)

Photos are always written to `data/uploads` first. With R2 configured, each one is also
copied to a bucket, and `/api/media` falls back to a five-minute signed R2 link for any
photo the local disk no longer has — after a disk failure or a move to a new server. A
failed copy is logged and never interrupts a guest. Retention deletes the cloud copy too.

```bash
R2_ACCOUNT_ID=...          # Cloudflare dashboard → R2 → Account ID
R2_ACCESS_KEY_ID=...       # R2 → Manage API tokens → Object Read & Write on the bucket
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=snaplorebooth    # keep the bucket private; the booth signs every link
```

## Running it on an iPad (no App Store)

For a booth you run yourself, the app does not need to be in the App Store. Once it is
online at an HTTPS domain (see *Deploy to a VPS*):

1. On the iPad open the domain in **Safari**, then **Share → Add to Home Screen**. It opens
   full screen from its own icon, like an app; updates arrive on the next reload.
2. Allow the camera when asked. In *Konsol → Kamera* pick the camera and mirroring.
3. Lock the iPad to the booth with **Settings → Accessibility → Guided Access**, then
   triple-click the side button inside the booth. Turn off Auto-Lock in Display settings.
4. Hold the standby logo for 3 seconds to reach the operator console.

A native wrapper (Capacitor, installed through TestFlight with a $99/year Apple Developer
account) only becomes necessary for printing with no dialog or for running without internet.

## Deploy to a VPS

One small Ubuntu VPS (2 GB RAM) runs the whole booth backend: pages, SQLite, Xendit and the
photos. `deploy/` holds the pieces.

```bash
# on the VPS, once
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs caddy
sudo useradd --system --create-home booth
sudo mkdir -p /opt/snaplorebooth && sudo chown booth /opt/snaplorebooth
# copy the project into /opt/snaplorebooth (git clone or rsync, without node_modules and data)
# then create /opt/snaplorebooth/.env.local with the production values:
#   OPERATOR_PASSWORD, XENDIT_SECRET_KEY, XENDIT_CALLBACK_TOKEN, PUBLIC_BASE_URL, optional R2_*
cd /opt/snaplorebooth && sudo -u booth npm ci && sudo -u booth npm run build
sudo cp deploy/snaplorebooth.service /etc/systemd/system/ && sudo systemctl enable --now snaplorebooth
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # edit the domain first
sudo systemctl reload caddy
```

Point the domain's DNS A record at the VPS; Caddy fetches the HTTPS certificate itself, so
the mkcert setup below is only for running the booth on a Mac on the LAN. In the Xendit
dashboard register `https://<domain>/api/payments/xendit` as the *QR code paid* webhook.
Later updates: copy the new code in and run `deploy/update.sh`. Back up `data/` — it holds
the database and the photos.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Paper estimate, printer state, counts; also runs the retention sweep |
| `GET` `POST` | `/api/sessions` | List sessions / start one from a package + add-ons |
| `GET` `PATCH` | `/api/sessions/[id]` | Read session with photos (contact details withheld) / update status, filter, `beauty`, template, `in_gallery`, `mirror` (refused once the sheet is made). The print count is fixed by what was paid |
| `DELETE` | `/api/sessions/[id]` | Discard a session the guest backed out of; refused once it has a photo, a sheet or a payment |
| `POST` | `/api/sessions/[id]/photos` | Store one captured frame (`{index, dataUrl}`) |
| `POST` | `/api/sessions/[id]/clips?index=n` | Store that shot's live clip (raw MP4/WebM body, 15MB max) |
| `POST` | `/api/sessions/[id]/live` | Store the live sheet video (raw MP4/WebM body) |
| `POST` | `/api/sessions/[id]/strip` | Store the composed board and send it to print (paid sessions only) |
| `POST` | `/api/sessions/[id]/deliver` | Record an email/SMS delivery target (no guest screen uses it yet) |
| `POST` `GET` | `/api/sessions/[id]/payment` | Issue (or reuse) the session's QRIS code / poll whether it is paid |
| `POST` | `/api/sessions/[id]/payment/simulate` | Pay the current QR from the Xendit sandbox — development keys only |
| `POST` | `/api/payments/xendit` | Xendit `qr.payment` webhook, verified by `x-callback-token` |
| `GET` | `/api/media/[...path]` | Serve a stored photo or clip (byte ranges, for Safari video), or redirect to its signed R2 copy |
| `PATCH` `POST` | `/api/operator/event` | Edit the running event, incl. `{ended}` / start a new one (operator only) |
| `POST` | `/api/operator/frames` | Store an uploaded frame: form-data `file` (prepared PNG), `name`, `theme`, `format`, `slots` (operator only) |
| `PATCH` | `/api/operator/frames/[id]` | Rename a frame, move it to another theme, or hide it from guests: `{"name"?, "theme"?, "hidden"?}` (operator only) |
| `DELETE` | `/api/operator/frames/[id]` | Delete an uploaded frame (operator only) |
| `GET` | `/api/frames/[id]` | Serve an uploaded frame's PNG to guest screens |
| `DELETE` | `/api/operator/sessions` | `{"ids":[…], "includeActive"?}` deletes the chosen sessions (10+ also need `"confirm":"HAPUS"`); `{"confirm":"HAPUS"}` alone deletes every guest's (operator only) |
| `PATCH` | `/api/operator/sessions` | `{"ids":[…], "in_gallery": bool}` shows or hides sessions in the event gallery (operator only) |
| `DELETE` | `/api/operator/events/[id]` | Delete a past event with all its sessions; the running event is refused (operator only) |
| `POST` | `/api/operator/sessions/[id]/cash` | Record a cash payment for an unpaid session; the kiosk moves on (operator only) |
| `POST` | `/api/operator/sessions/[id]/reprint` | Record `{"copies": n}` sheets printed again, for the paper count (operator only) |
| `GET` `PATCH` `DELETE` | `/api/operator/settings` | The booth settings and their defaults / change any subset (refused with the reason when invalid) / back to defaults (operator only) |
| `GET` `POST` | `/api/operator/storage` | Disk use by kind / *Optimalkan sekarang* (operator only) |
| `GET` | `/api/operator/export` | `?kind=csv&r=today\|7d\|30d\|event\|all` sessions as CSV; `?kind=zip&event=<id>[&all=1]` an event's sheets (or everything) as a ZIP; `?kind=db` a database backup (operator only) |
| `POST` | `/api/camera/calibrate` | Automatic camera setup over USB; returns each setting found and what was done (operator only) |
| `POST` | `/api/camera/focus` | `{ locked }`: focus once and keep it for every shot, or back to focusing per shot (operator only) |
| `GET` | `/api/events/[slug]/gallery` | `{ ended, items }` for the event link; 404 when its gallery is off |
| `GET` | `/manifest.webmanifest`, `/apple-icon`, `/pwa-icon/[size]` | What "Add to Home Screen" installs |

Uploads accept base64 `png`/`jpeg`/`webp` data URLs up to 12MB; path segments are sanitised
and reads are confined to `data/uploads`.

## Payment: QRIS via Xendit

Every session is paid before the camera opens. `/capture/[id]` redirects to `/pay/[id]`
until the session is paid, and the photo and tethered-capture endpoints answer `402` for an
unpaid session, so skipping the payment screen by URL gets a guest nothing.

```bash
XENDIT_SECRET_KEY=xnd_development_...   # Dashboard → Settings → API Keys (Money-in: write)
XENDIT_CALLBACK_TOKEN=...               # Dashboard → Settings → Webhooks → verification token
PAYMENT_QR_TTL_MINUTES=10               # optional; an expired code can be reissued from the screen
PAYMENT=off                             # optional; runs the booth free (rehearsals, private events)
```

The price is computed on the server from the package and add-ons; the kiosk never sends
an amount. The secret key stays on the server; the tablet only sees the `qr_string`.

Payment is settled two ways, whichever lands first:

- **Webhook** — register `https://<public-host>/api/payments/xendit` for *QR code paid*.
  Needs a public URL; on a LAN-only booth use a tunnel (e.g. `cloudflared`) or skip it.
- **Polling** — while the QR is on screen the kiosk polls every 2.5s and the server asks
  Xendit for the QR's payments (at most once per 3s per code). This alone is enough for a
  booth with no public URL.

With a `xnd_development_` key the payment screen shows a **Simulate payment** button that
pays the code from Xendit's sandbox; it is refused with a production key.

## HTTPS, and why the booth needs it

`getUserMedia` only runs in a secure context. `localhost` qualifies, so plain `npm run dev`
is fine on the host machine — but the tablet reaches the booth at a LAN address, where the
browser will refuse the camera outright over `http://`.

A certificate covering localhost and this machine's LAN IP is generated with `mkcert`:

```bash
npm run certs        # regenerate after the LAN IP changes
npm run dev:https    # https://localhost:4300 and https://<lan-ip>:4300
```

`certs/` is gitignored — the key never belongs in the repo.

For the tablet to trust it, install the mkcert root CA on the tablet once: AirDrop
`rootCA.pem` from `$(mkcert -CAROOT)`, open it, then **Settings → General → VPN & Device
Management** to install the profile, and **Settings → General → About → Certificate Trust
Settings** to switch full trust on. Without that last step iOS installs the certificate but
still refuses to trust it, and the camera stays blocked.

## The operator console is locked

`/operator` and `GET /api/sessions` expose guest email addresses and phone numbers, so they
sit behind HTTP Basic auth. `POST /api/sessions` stays open — that is the kiosk starting a
guest session, and locking it would only break the booth.

```bash
OPERATOR_PASSWORD=choose-something npm run dev:https
```

With no `OPERATOR_PASSWORD` set the console returns 503 rather than falling back to a weak
default. Any username is accepted; only the password is checked, in constant time.

There is no operator button on the guest screens. **Press and hold the logo on the standby
screen for 3 seconds** to open `/operator`; the browser then asks for the password. The
console shows today's revenue from settled Xendit payments (not from sessions that reached
the last screen), and `/operator/camera` is where the guest camera is chosen — the iPad's
own, or a Canon through an HDMI capture card — and whether the preview is mirrored. Those
two choices are saved on the device they are made on.

## Camera: tablet webcam or tethered body

Capture sits behind a `CameraSource` interface with three backends, chosen by
`CAMERA_SOURCE`:

| Value | Behaviour |
| --- | --- |
| `browser` (default without gphoto2) | Any camera the browser can see via `getUserMedia`, composited on a canvas. The capture screen offers a device picker, so a Canon exposed as a webcam (EOS Webcam Utility, or an HDMI capture dongle) is selectable and remembered |
| `gphoto2` (default with gphoto2 installed) | Offers a tethered body (Canon EOS M50 / M50 Mark II) over USB, driven by `gphoto2` |
| `folder` | Watches a directory and ingests stills dropped there by another tethering app |
| `simulator` | A synthetic stream and stills, for exercising the pipeline with no hardware |

**Every device shoots with its own camera by default** (the MacBook's, the iPad's, or a
capture card it sees). The Canon is opt-in per device at *Konsol → Kamera*: **Canon (USB)**
first detects it, and the device switches only if it answers ready; otherwise it stays on its
own camera and says why. The choice is stored on that device, so a MacBook can test with its
webcam while the iPad booth uses the Canon. A device on its own camera never probes or wakes
the Canon. With `CAMERA_SOURCE` unset, the server offers the Canon whenever gphoto2 is
installed (a VPS without it stays browser-only).

**Calibration** (*Konsol → Kamera*, once the Canon is connected) reads the body's dial mode,
battery, auto power-off and aspect ratio, takes two test shots (brightness of the photo,
shutter lag as this device sees it) and a focus test (a capture that fires only if autofocus
locks), then lists what to change on the camera. The measured lag is stored on the device,
so the countdown's flash lands on zero from the first guest.

### If macOS will not release the camera

The booth now handles the usual case itself. ptpcamerad runs as the logged-in user, so when a
gphoto2 run fails with "Could not claim the USB device", the server stops ptpcamerad (no sudo)
and retries the run once. A live view that keeps dropping does the same before reconnecting.
When the server is stopped (Ctrl+C, `kill`), it closes every viewfinder stream and ends its
gphoto2 live view. Before this, an open viewfinder kept the old server from exiting and its
live view held the camera, so the next server found the camera taken. Whether the body fires
EOS-style is remembered only once it has actually answered, never after a failed ask. The rest
of this section covers what is left: Image Capture or Photos holding the camera, or a
root-owned daemon.

`gphoto2` is not the only way to reach a Canon body, and on macOS it is the one the system
fights (see below). Two routes avoid PTP entirely:

**As a webcam.** Canon's EOS Webcam Utility, or a cheap HDMI capture dongle fed from the
camera's clean HDMI out, presents the body as an ordinary UVC device. Nothing in this app
changes: stay on `CAMERA_SOURCE=browser` and pick the Canon in the capture screen's camera
selector. Live-view resolution rather than full sensor, which is usually plenty for a
printed strip.

**As a watch folder.** Let EOS Utility, Smart Shooter or Lightroom own the camera and
download to a folder; this app ingests from it at full sensor resolution.

```bash
CAMERA_SOURCE=folder CAMERA_WATCH_DIR=~/Pictures/tether npm run dev:https
```

The shutter is fired by that app or by the photographer; `capture` waits up to
`CAMERA_WATCH_TIMEOUT_MS` (default 20000) for a new file, and waits for the file size to
stop changing before ingesting so a still being written over USB is never picked up
half-complete. Ingested files are moved out of the watch folder. There is no server live
view on this backend — pair it with the tablet camera or a capture device for the preview.

```bash
brew install gphoto2 libgphoto2
sudo killall ptpcamerad     # see below — the sudo is not optional
gphoto2 --auto-detect       # expect: Canon EOS M50   usb:...
CAMERA_SOURCE=gphoto2 npm run dev:https
```

### macOS fights you for the camera

Attach a Canon body to a Mac and `ptpcamerad` claims USB interface 0 immediately. The
camera still appears in `gphoto2 --auto-detect` — it just cannot be talked to, and every
capture fails with `Could not claim the USB device`.

On macOS 26 (Darwin 27) with SIP enabled, releasing it is harder than the usual advice
suggests. What was actually observed on this machine, with a real EOS M50 attached:

- `/usr/libexec/ptpcamerad` is flagged `restricted` and is a **platform binary**, but it
  runs as the **logged-in user** (uid 502) from
  `/System/Library/LaunchAgents/com.apple.ptpcamerad.plist`, in the `gui/<uid>` domain —
  not as a system daemon.
- `killall ptpcamerad` prints nothing and changes nothing. `launchctl kill SIGKILL
  gui/<uid>/com.apple.ptpcamerad` answers **`Not privileged to signal service`**. SIP
  refuses the signal even though the process belongs to the user.
- Across two hours of attempts the PID never changed, which is the tell: the process was
  never killed and restarted, it was simply never killed.

Try, in this order, and read the PID afterwards — a *new* PID means it died and respawned,
the *same* PID means nothing happened:

```bash
sudo launchctl kill SIGKILL gui/$(id -u)/com.apple.ptpcamerad; gphoto2 --summary
sudo launchctl bootout gui/$(id -u)/com.apple.ptpcamerad;      gphoto2 --summary
```

If both are refused, macOS is not going to give this camera up, and the booth belongs on a
Linux host. Nothing in this application changes: install `gphoto2` there, set
`CAMERA_SOURCE=gphoto2`, point the tablet at that machine.

Because of this, `/api/camera` treats *enumeration* and *readiness* as different things: it
probes with `gphoto2 --summary`, which actually claims the device, and reports `ready:false`
with the fix in `hint` when macOS is holding it. A booth that runs all evening is better off
on a Linux host (a NUC or Raspberry Pi), where no such daemon exists.

### Automatic calibration

*Konsol → Kamera → Kalibrasi otomatis* gets a Canon ready in about 30 seconds. Over USB it
sets JPEG only (RAW would hand over the wrong file; *Medium Fine* when it has to choose),
single-frame drive, one-shot AF (manual focus is left alone), auto power-off disabled, 3:2,
and pulls shutter and aperture back inside 1/250–1/60 and f/3.5–f/11. Then it takes test
shots, measures their brightness and corrects — ISO first when it is fixed, then shutter,
then aperture, within those limits — until a shot lands in range (at most three), times the
shutter lag (stored on this device for the countdown) and tests autofocus. Each change is
listed (*ISO: 400 → 800, foto terlalu gelap*); what USB cannot set, such as the mode dial,
comes with what to do on the body. *Cek saja* measures without changing anything. The
exposure maths is `src/lib/camera/exposure.ts`; the USB setup is `autoSetup()` in
`src/lib/camera/gphoto2.ts` (`POST /api/camera/calibrate`, operator only).

### Operator diagnostics

`/operator/camera` shows the detected body, port, readiness with the reason when it is not
ready, live view, the exposure values the body advertises, and a **test shot** that reports
its own end-to-end latency — the number to tune the capture countdown against before doors
open. It is operator-only, as are `/api/camera/settings` and `/api/camera/test`, because
both move real hardware.

With `gphoto2` the capture screen plays the server's live view at `/api/camera/liveview`
into a canvas, stills come down at full resolution rather than being re-encoded from a
canvas, and the exposure the body reports is shown and settable in `/operator/camera`. The
canvas is also what each shot's live clip records, so tethered sessions get the same clips
and live sheet as a webcam (at live-view resolution).

Only one process may hold the camera over PTP, so every camera operation is serialised
through one lock. One gphoto2 live-view process feeds every open viewfinder at up to 30 fps
(12 through a Cloudflare tunnel), dropping frames a slow client has not taken. The rate is
paced by credit rather than a minimum gap, which halved a body running just above the cap
(an M50's ~33 fps came out at 16). The viewfinder draws only the newest frame, skipping stale
ones that arrive in a clump, and a hidden tab lets go of the stream. It
pauses for each still while the viewfinders stay connected, stops 15 seconds after the last
one closes (live view drains the battery), and retries if the body drops it. While it runs,
`/api/camera` answers from the last probe instead of reporting the busy camera as broken.

Commands are addressed to the camera by `--port`. An iPhone or iPad plugged into the Mac
enumerates as a PTP camera too, and gphoto2 would otherwise drive whichever it finds first;
Apple devices are skipped, or set `GPHOTO2_CAMERA` (a model substring) to choose. gphoto2
exits 0 for many refusals, so the printed `*** Error ***` text is what marks a failed shot.

A tethered body fires a second or more after it is asked (live view stops, the body
autofocuses), so the flash is tied to the shutter, not to the countdown. `POST
/api/camera/capture` answers with a short event stream: `fired` as soon as gphoto2 reports
the new file, then `done` with the photo, or `error`. gphoto2 runs under a pseudo-terminal
(`script` on macOS, `stdbuf` on Linux) because over a pipe it prints nothing until it exits.
The capture screen counts 3-2-1, shows *Tahan!* until `fired`, and flashes then. Each shot
is requested early by the lag measured on earlier shots (kept per device, at most 1 s, since
live view freezes from the request on), so the shutter lands close to zero. A capture that
takes over 20 s is killed (SIGKILL; gphoto2 blocked on the camera ignores SIGTERM) and the
guest is asked to retry; live view is stopped with SIGINT so the body leaves PC live view
cleanly. `CAMERA_SOURCE=simulator SIMULATOR_SHUTTER_MS=1500` rehearses this timing without
hardware.

A Canon EOS body is fired the way a photographer would: half-press to focus (0.7 s), then a
full press that fires whether or not focus locked (`eosremoterelease`), then `Release`, then
the file is downloaded. `Release`, not `Release Full`: in libgphoto2 2.5.34 `Press Full MF`
presses half and full together and `Release Full` lets go of the full press only, so the
half-press stayed held after every shot and kept the body focusing with its AF-assist lamp lit. gphoto2's own `--capture-image-and-download` refuses to fire without focus
("Perhaps no focus?") and then hangs about 90 s; on an M50 in a dim room that was most
shots. Any printed error now kills the process at once. Other bodies use plain capture.

**Focus lock** (*Konsol → Kamera → Fokus*). The red light an M50 shows before a shot is its
AF-assist lamp: it lights whenever the body autofocuses in a dim room, and by default the booth
autofocuses before every shot. *Kunci fokus* turns the body's Continuous AF off and focuses
once at whoever stands at the guests' spot (the lamp may light that once). From then on every
shot is a full press without autofocus (`Press Full MF`): no lamp, and about 0.7 s quicker.
The setting survives a restart (`camera.focusLock` in the database). *Fokus ulang* refocuses,
and *Otomatis lagi* turns Continuous AF back on. While the focus is locked, the calibration skips its
autofocus test, because that test autofocuses and would move the lens. The kiosk keeps a separate
shutter-lag figure per focus mode, so switching does not throw the countdown off. Refocus
after moving the camera, zooming, or switching the body off. An STM lens loses its focus
position on power-off. The M50's AF-assist lamp setting itself is not reachable over USB, and
its focus mode reads *AI Servo* with no other choice, so locking is done by never
half-pressing.

The still's aspect ratio is read from the body (an M50 refuses to change it over USB:
"Device Busy"), and the kiosk cuts live view to it, so a body set to 16:9 previews the same
16:9 middle it will shoot. Set it to 3:2 on the camera to use the whole sensor.

Open the booth screen locally, not through the tunnel. Measured on an M50: each live-view
frame is 480 × 320 but about 80 KB (some 20 Mbit/s at full rate). From `localhost` the first
frame came in 75 ms with steady gaps; through the trycloudflare address the same stream took
1.7 s to start and arrived in clumps up to 0.5 s apart, since every frame leaves the building
and comes back.

Measured on a real EOS M50 (firmware 1.0.3) on macOS: live view 480 × 320 whatever
*Live View Size* says, first frame ~1.5 s after a cold start, ~2.2 s from the request to the
JPEG on disk, and the on-screen flash 85–190 ms after the countdown's zero. A body that cannot focus refuses to fire; the capture is retried once, then
the guest is asked to step back and retry. Set the body to a photo mode (M or Av), still
aspect ratio 3:2 (the live view is 3:2, so framing matches), auto power off disabled, and run
it from a DC coupler for a whole event.

### Camera API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/camera` | Backend, detected model and port, current settings |
| `GET` | `/api/camera/liveview` | `multipart/x-mixed-replace` MJPEG live view |
| `POST` | `/api/camera/capture` | Fire the shutter for `{sessionId, index}` |
| `POST` | `/api/camera/settings` | Set `iso`, `aperture`, `shutterspeed` on the body |
| `POST` | `/api/booth/heartbeat` | A booth screen reporting itself (open; kiosk has no login) |
| `GET` `POST` | `/api/operator/printer` | The watched printer and its IPP status / choose it (`{uri}`) (operator only) |
| `GET` | `/api/operator/printer/discover` | AirPrint printers on the network and the server's own (operator only) |
| `POST` | `/api/operator/paper` | Record a paper refill (`{sheets}`) (operator only) |
| `GET` | `/api/camera/status` | Dial mode, battery, auto power-off, aspect ratio, exposure: the calibration checklist (operator only) |
| `POST` | `/api/camera/test` | Diagnostic shot as an event stream (`fired`, `done`/`error`, each with `ms`); `?focus=1` fires only if autofocus locks (operator only) |

## Data retention

Guest photos are personal data, so the booth forgets them. Sessions older than the window
set in *Pengaturan → Penyimpanan* (one week by default — long enough to download from the QR
after the party; `RETENTION_HOURS` only sets the default) are deleted with their stored files
and their R2 copies, by a throttled sweep that runs off `/api/status` — the endpoint the
standby screen pings every minute, so no separate scheduler is needed. The share screen states
the actual window.

**Storage.** Videos take three quarters of the disk, so they have their own, shorter window
(3 days by default): their files go, the photos, sheet and QR page stay. Video quality
*Standar* records countdown clips at 1.6 Mbps and the whole-sheet video at 3 Mbps (about 40%
less than before); *Hemat* halves that again. Camera photos are kept at 2400 px on the long
edge at 85% JPEG: a tethered body's file is shrunk with macOS `sips` before it is stored and
shown (a Linux server keeps it as shot), and this device's own camera is scaled in the
browser. *Optimalkan sekarang* applies the windows now, deletes console test shots and folders
no session owns, shrinks older camera photos still above the size (up to 300 per run), and
compacts the database, then reports what it freed. Disk use is shown by kind.

**Finding a session.** The *Sesi* log searches by code (any part of it, any case), across
every session the booth still holds, not only the newest 60.

**One session.** With exactly one ticked: *Tandai lunas (tunai)…* records a cash payment
for a guest whose QRIS failed — the booth screen waiting on the QR moves on to the photos on
its next poll, and the revenue counts it; *Cetak ulang* opens `/operator/cetak/[id]`, the
sheet and a copies stepper for the system print dialog (4×6 in, borderless), and records the
copies once the dialog closes so the paper count stays true.

**Some sessions.** Tick sessions in the console's *Sesi* log (one, a few, or every one
shown) and choose *Keluarkan dari galeri*, *Masukkan ke galeri* or *Hapus…*. Each asks first
and lists the codes; deleting 10 or more also asks for `HAPUS`. Sessions a guest may still be
using are left alone unless the operator ticks *Ikut hapus*. Past events can be deleted with
their sessions from *Acara sebelumnya* (the running event cannot).

To wipe guest data now — test sessions before going live, or at a client's request — use
**Data tamu → Hapus semua foto tamu** in the console. It shows what will be lost and asks the
operator to type `HAPUS`. Every guest's photos, videos and session record go (QR links and the
event gallery empty, today's stats return to 0); events, prices, frames and the Xendit
dashboard's payment records stay. Guests at the booth right now — unfinished sessions under
30 minutes old — are skipped.

## Known limits

- **Printing goes through the print sheet.** AirPrint mode needs a tap on *Print* each time;
  the app cannot tell whether paper actually came out. Paper level is an estimate from prints
  recorded today (`PAPER_ROLL_CAPACITY` in `src/lib/db.ts`).
- **On a Mac on the LAN without a tunnel, the take-home QR only works on the booth's network.**
  With `npm run tunnel` running it uses the tunnel; deployed with `PUBLIC_BASE_URL`, it works
  from anywhere.
- **The booth needs internet when deployed.** The iPad loads the app and uploads photos to
  the VPS; bring a modem rather than relying on venue Wi-Fi.
- **Email/SMS delivery has no guest screen.** The endpoint remains; nothing sends mail.
- **Tethering needs the Mac (or a Linux box) at the booth.** gphoto2 runs on the server,
  so an iPad-only booth uses the Canon through an HDMI capture card on `browser` instead.
  The tethered path has been run end to end against a real EOS M50 (live view, stills,
  clips, live sheet); on this Mac `ptpcamerad` no longer held the camera. Tethered live view
  is 480 × 320, so viewfinder and clips are softer than the stills.
- Prices render through `formatPrice`, which renders the stored Rupiah amount with Indonesian
  thousands separators — adjust it if you move to another currency.
# SnapLoreBooth
