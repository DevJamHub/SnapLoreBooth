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
touch targets, and a step indicator (Pilih → Hias → Bayar → Foto → Cetak; *Bayar* disappears
when the event is free). Every screen finds its own way back to standby, and on standby only
the *Sentuh untuk mulai* button starts a session.

| Route | What happens | Clock |
| --- | --- | --- |
| `/` | Standby: drifting polaroids and one start button | — |
| `/paket` | 6 / 4 / 3 poses or one portrait, all on **one uncut 4R sheet**; a stepper adds extra sheets (+1 cetak) | back to standby after 60s untouched |
| `/hias/[id]` | Pick the frame and the colour look on a live preview of the sheet | 5 minutes, then continues with what is selected |
| `/pay/[id]` | QRIS from Xendit; moves on by itself once paid. *Batal* asks first while a code is live | back to standby 45s after the code expires |
| `/capture/[id]` | Camera on the left, the sheet filling in on the right. 3-second countdown per shot; afterwards tap any photo on the sheet to retake it | 10 minutes, then missing shots are taken and the sheet goes to print |
| `/share/[id]` | Print (simulated or AirPrint), QR to save to a phone, opt out of the live gallery | 45s after printing; 3 min if never printed |
| `/d/[id]` | What the QR opens: the sheet, every photo, and every **live clip** | — |
| `/g/[slug]` | The event link: rotating live sheets while it runs, the photo gallery once it ends | — |

The viewfinder takes the exact shape of a photo slot on the chosen sheet, so what the guest
frames is what prints. Stills are saved as the sensor saw them — not mirrored, not filtered;
the look is applied once, when the sheet is composed. Filters are plain colour operations
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
PUBLIC_BASE_URL=https://booth.example.com   # where QR codes point; defaults to the request host
EVENT_NAME="SnaploreBooth"                  # only names the very first event on a fresh booth
```

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
| `GET` `PATCH` | `/api/sessions/[id]` | Read session with photos (contact details withheld) / update status, filter, template, `in_gallery`. The print count is fixed by what was paid |
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
| `browser` (default) | Any camera the browser can see via `getUserMedia`, composited on a canvas. The capture screen offers a device picker, so a Canon exposed as a webcam (EOS Webcam Utility, or an HDMI capture dongle) is selectable and remembered |
| `gphoto2` | A tethered body (Canon EOS M50 / M50 Mark II) over USB, driven by `gphoto2` |
| `folder` | Watches a directory and ingests stills dropped there by another tethering app |
| `simulator` | A synthetic stream and stills, for exercising the pipeline with no hardware |

### If macOS will not release the camera

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

### Operator diagnostics

`/operator/camera` shows the detected body, port, readiness with the reason when it is not
ready, live view, the exposure values the body advertises, and a **test shot** that reports
its own end-to-end latency — the number to tune the capture countdown against before doors
open. It is operator-only, as are `/api/camera/settings` and `/api/camera/test`, because
both move real hardware.

With `gphoto2` the kiosk swaps its `<video>` element for the server's MJPEG stream at
`/api/camera/liveview`, stills come down at full sensor resolution rather than being
re-encoded from a canvas, and the shutter/aperture/ISO readout in the capture dock reflects
what the body actually reports.

Only one process may hold the camera over PTP, so live view is torn down before each still
and restarted afterwards; every camera operation is serialised through one lock.

### Camera API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/camera` | Backend, detected model and port, current settings |
| `GET` | `/api/camera/liveview` | `multipart/x-mixed-replace` MJPEG live view |
| `POST` | `/api/camera/capture` | Fire the shutter for `{sessionId, index}` |
| `POST` | `/api/camera/settings` | Set `iso`, `aperture`, `shutterspeed` on the body |

## Data retention

Guest photos are personal data, so the booth forgets them. Sessions older than
`RETENTION_HOURS` (default 168, one week — long enough to download from the QR after the
party) are deleted with their stored frames, and their R2 copies, by a throttled sweep that
runs off `/api/status` — the endpoint the standby screen pings every minute, so no separate
scheduler is needed. The share screen states the actual window.

```bash
RETENTION_HOURS=6 npm run dev   # shorter window for a one-night event
```

## Known limits

- **Printing goes through the print sheet.** AirPrint mode needs a tap on *Print* each time;
  the app cannot tell whether paper actually came out. Paper level is an estimate from prints
  recorded today (`PAPER_ROLL_CAPACITY` in `src/lib/db.ts`).
- **On a Mac on the LAN, the take-home QR only works on the booth's network.** Deployed to a
  VPS with `PUBLIC_BASE_URL`, it works from anywhere.
- **The booth needs internet when deployed.** The iPad loads the app and uploads photos to
  the VPS; bring a modem rather than relying on venue Wi-Fi.
- **Email/SMS delivery has no guest screen.** The endpoint remains; nothing sends mail.
- **The tethered path is verified only up to the macOS claim.** A real Canon EOS M50 has
  been attached and is correctly detected, and the readiness probe and every failure path
  were confirmed against it. Nothing beyond that is proven: no frame has been captured, so
  live view framing, shutter latency and M50 firmware quirks remain untested until
  `ptpcamerad` is released with sudo. On `browser` the shutter/aperture/ISO readout stays
  decorative.
- Prices render through `formatPrice`, which renders the stored Rupiah amount with Indonesian
  thousands separators — adjust it if you move to another currency.
# SnapLoreBooth
