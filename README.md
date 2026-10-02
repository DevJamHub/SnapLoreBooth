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
touch targets, and a step indicator (Pilih → Bayar → Foto → Hias → Cetak; *Bayar* disappears
when payment is off). Every screen finds its own way back to standby.

| Route | What happens | Returns to standby |
| --- | --- | --- |
| `/` | Standby: drifting polaroids, "Sentuh untuk mulai". A touch anywhere starts | — |
| `/paket` | Pick Strip Klasik 2x6 / Kartu Pos 4x6 / Satu Potret 1:1, optional extra print | after 60s untouched |
| `/pay/[id]` | QRIS from Xendit; moves on by itself once paid. *Batal* asks first while a code is live | 45s after the code expires |
| `/capture/[id]` | Full-screen viewfinder. One tap starts; every pose then runs itself (5s, then 3s per pose) with a snapshot after each | — (paid) |
| `/review/[id]` | *Hias*: pick a colour (filter) and a frame on the composed board | prints itself after 60s |
| `/share/[id]` | Print progress, QR to save to a phone | 45s after printing |
| `/d/[id]` | What the QR opens on the guest's phone: the board and each frame | — |

Stills are saved exactly as the sensor saw them — not mirrored, not filtered. The look is
applied once, when the board is composed, so it can never be applied twice. Filters are
plain colour operations (`FILTERS` in `src/lib/packages.ts`) applied with `ctx.filter` where
the browser supports it and pixel by pixel where it does not (Safari before 18).

Add-ons are limited to what the booth actually delivers: today that is one extra print.

### Booth settings

```bash
EVENT_NAME="Nikahan Rina & Dimas"   # printed under the photos on frames that carry a name
PUBLIC_BASE_URL=https://booth.example.com   # where the take-home QR points; defaults to this host
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Paper estimate, printer state, counts; also runs the retention sweep |
| `GET` `POST` | `/api/sessions` | List sessions / start one from a package + add-ons |
| `GET` `PATCH` | `/api/sessions/[id]` | Read session with photos (contact details withheld) / update status, filter, template. The print count is fixed by what was paid |
| `POST` | `/api/sessions/[id]/photos` | Store one captured frame (`{index, dataUrl}`) |
| `POST` | `/api/sessions/[id]/strip` | Store the composed board and send it to print (paid sessions only) |
| `POST` | `/api/sessions/[id]/deliver` | Record an email/SMS delivery target (no guest screen uses it yet) |
| `POST` `GET` | `/api/sessions/[id]/payment` | Issue (or reuse) the session's QRIS code / poll whether it is paid |
| `POST` | `/api/sessions/[id]/payment/simulate` | Pay the current QR from the Xendit sandbox — development keys only |
| `POST` | `/api/payments/xendit` | Xendit `qr.payment` webhook, verified by `x-callback-token` |
| `GET` | `/api/media/[...path]` | Serve a stored image from the upload root |

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
`RETENTION_HOURS` (default 24) are deleted with their stored frames by a throttled sweep
that runs off `/api/status` — the endpoint the kiosk already polls every 15 seconds, so no
separate scheduler is needed. The consent checkbox on the share screen states the actual
window rather than a vague promise.

```bash
RETENTION_HOURS=6 npm run dev   # shorter window for a one-night event
```

## Known limits

- **Printing is simulated.** The print screen advances on a timer (`SECONDS_PER_COPY` in
  `ShareStage.tsx`) and paper level is derived from prints recorded today
  (`PAPER_ROLL_CAPACITY` in `src/lib/db.ts`). The operator console says so.
- **The take-home QR only works on the booth's network.** It points at this server unless
  `PUBLIC_BASE_URL` is set, so a guest's phone must reach it — and trust its certificate.
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
