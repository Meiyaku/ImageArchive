# Image Archive — development notes

Session log of what was built, the decisions behind it, and what's still open.
Technical reference for working in the code lives in [`web/CLAUDE.md`](web/CLAUDE.md).

## What it is

A private, multi-user photo archive at **imagearchive.snowborn.com**, running on the
k3s cluster at k3s.snowborn.com. Users sign in, keep albums of items (a photo plus
notes), and can share an album as a story PDF.

- **Stack:** React 19 + Vite + Tailwind 4 client; Express 5 API run as TypeScript by
  Node 24; Postgres 17. One container serves both the API and the client.
- **Storage:** Postgres for data; photos on a 50 GB persistent volume, only served
  through routes that check the signed-in user owns them.

## Features, in the order they were built

1. **Login and accounts.** Login is the start page; there's no self sign-up. The first
   admin is created on first deploy (the deploy script asks for it on the node). Admins
   create users, reset passwords, grant/remove admin and delete users from
   **Manage users** (account menu → `/admin`). Everyone can change their own password.
2. **Albums.** My Albums lists albums by name with a thumbnail and item count. Each
   row's ⋯ menu has Edit album, Share story and Delete; New album is in the header.
3. **Items.** The album page is a photo grid with an Add button. An item has a photo,
   public notes and private notes.
4. **iPhone uploads.** The picker offers Photo Library / Take Photo / Choose File.
   The browser converts photos (including HEIC) to JPEG ≤2560px before uploading,
   with a progress bar; the server stores a ≤3000px upright JPEG and a thumbnail.
5. **Sequence.** Each item has a number that orders the grid. Left blank it counts up
   from 1 (one past the album's highest). Duplicates allowed; no auto-renumbering.
   Existing items were numbered in the order they were added.
6. **Read-only item view.** Opening an item shows it read-only; changes need **Edit**.
   Save or Cancel returns to the view. Delete is only in edit mode.
7. **Title.** Optional, up to 200 characters.
8. **Grid captions.** Tiles show the title, or `#<sequence>` if untitled. Public notes
   aren't shown on tiles.
9. **Album cover photo and intro.** Set in Edit album: upload a photo, or choose one
   from the album (copied, so it survives the item being deleted). The cover is also
   the album's thumbnail on My Albums.
10. **Share story PDF.** US Letter, continuous flow: optional cover page (name, cover
    photo, intro), then each item in sequence order — photo, title, public notes.
    **Private notes are never included.** Create PDF → Share opens the iPhone share
    sheet; computers get a download.
11. **Show password.** An eye button on the sign-in and Change password fields
    reveals what's been typed; it starts hidden every time.
12. **Sign-in log.** Every sign-in attempt is recorded with the username typed, the
    result (signed in / failed / slowed down), IP address, device and time. Admins see
    it under **Sign-in log** (account menu, or the button on Manage users), with a
    "failed attempts only" filter. Kept 90 days. Passwords are never recorded.
13. **Choose photos for the PDF.** Share story offers **All photos** or **Choose
    photos**: tap thumbnails to pick (Select all / Clear). Picked photos still appear
    in sequence order.

## Security review (2026-11-12)

A review of the whole codebase found nothing critical. Fixed:

- **Oversized images** (a 758 KB upload decoded to 16,000×16,000 used ~460 MB): images
  over 100 megapixels are now rejected from the header, before decoding; the two
  resize steps no longer run at the same time.
- **Login lockout abuse**: the IP+username lockout could lock users out if everyone
  shares the load balancer's IP. Replaced with per-username growing delays (up to 3 s)
  that handle one attempt at a time, so guessing stays slow but the real user can
  always sign in. Memory use is capped.
- **Username discovery by timing** (unknown usernames answered ~20× faster): unknown
  usernames now go through the same password check.
- **Security headers**: strict Content-Security-Policy, framing blocked (clickjacking),
  nosniff, referrer policy; HSTS switches on automatically once HTTPS is in place.
- **Password change** now signs out the user's other devices.
- **Deploy secrets**: created on the node from stdin (never on a command line); the
  first-admin password is removed from the cluster secret after a successful deploy.
- **`Origin: null`** caused a 500; now a clean 403.
- **Hardening**: uploads limited to photo formats (no SVG etc.); a NetworkPolicy lets
  only the app reach Postgres.

Checked and fine: users can't reach each other's data; admin routes are admin-only;
all SQL is parameterised; no raw HTML rendering; CSRF protection; file paths can't
escape the uploads folder; private notes never reach the PDF; production dependencies
have no known vulnerabilities.

## Security scan (2026-11-24)

A second full scan (code, k8s, deploy scripts, dependencies, git history) found
nothing critical; HTTPS is still the main open risk. Fixed:

- **Sign-in flooding**: made-up usernames skipped the per-username delays, and every
  attempt costs a password hash (~16 MB) and a log row. Added per-IP growing delays
  (not reset by signing into one's own account), a cap of 4 password checks at once
  across the server, and a 100,000-row cap on the sign-in log, pruned hourly.
- **Change password** wasn't throttled, so a stolen session could guess the current
  password quickly. Now throttled per user.
- **App reachable by any pod**: a NetworkPolicy now admits only Traefik, so other
  pods can't bypass it and fake client IPs or HTTPS.
- **Container hardening**: the app pod now runs as non-root with a read-only
  filesystem, no capabilities and no Kubernetes API token.
- **Deploy**: builds in a fresh private temp directory on the node instead of a fixed
  `/tmp` path.
- **Images pinned by digest** (node, postgres, rclone); see CLAUDE.md for bumping them.
- **Dev dependencies**: `npm audit fix` cleared 9 moderate issues in the lint
  toolchain (none shipped in the image).

Not changed: backups stay unencrypted on the NAS (below), and Postgres and the backup
job were not hardened further, given Postgres's start-up history on this cluster.

## Backups (2026-11-12)

Nightly at 09:00 UTC a Kubernetes CronJob copies to `\\192.168.10.20\K3S_Backups\imagearchive`:
a compressed database dump (`database/`, last 30 days kept) and every photo
(`photos/`, only new ones sent each night, never deleted from the NAS). The NAS
sign-in is asked for once, on the node, by the deploy script. How to run one on
demand, check it, and restore is in `web/CLAUDE.md` under **Backups**.

Backups are stored unencrypted on the NAS, including private notes in the database
dump; anyone with access to that share can read them.

## Cluster change: real client IPs (2026-11-13)

The sign-in log showed internal 10.42.x.x addresses because k3s's ServiceLB hid the
real client IP from Traefik. Fixed cluster-wide by setting Traefik's Service to
`externalTrafficPolicy: Local` in `/var/lib/rancher/k3s/server/manifests/traefik-config.yaml`
on the node (a HelmChartConfig; k3s's own `traefik.yaml` is left alone). Verified: the
log now shows real addresses. Safe on this single-node cluster; no Traefik IP
allow-lists existed. Undo: delete that file and `sudo systemctl restart k3s`. If a second
node is ever added, only the node running Traefik will accept web traffic.

## Cluster change: Postgres signals and AppArmor (2026-11-24)

Since Nov 19, Postgres took ~5 minutes to become ready after a restart. Cause: kernels
newer than 7.0.0-38 enforce Ubuntu's `kernel.apparmor_restrict_unprivileged_unconfined = 1`,
which gave every container a stacked AppArmor label (`…//&unconfined`). The container
profile then refused the signals Postgres sends between its own processes (~32,000
denials in one boot), so its wakeups were lost until a 5-minute timer fired.

Fixed node-wide by adding `kernel.apparmor_restrict_unprivileged_unconfined = 0` in
`/etc/sysctl.d/20-apparmor.conf` (it loads after the package's `10-apparmor.conf`).
Containers keep their normal AppArmor profile. Verified: after restarting, both the
imagearchive and crafting-catalog databases were ready in 10 seconds, and after a full
reboot (kernel 7.0.0-44) the setting held with no Postgres signal denials. The cost is a
host hardening default from July, which affects programs on the VM, not containers.
Undo: delete the file and `sudo sysctl -w kernel.apparmor_restrict_unprivileged_unconfined=1`.
Carry the file into any rebuild of the VM.

## Key decisions

- **Deploy like movietracker:** `web/scripts/deploy.sh` copies the source to the node
  over SSH, builds there with its Docker, pushes to the node's registry
  (`localhost:5000`) and runs `kubectl apply -k`. No container tooling needed locally.
- **Sessions:** random token in an httpOnly cookie; only its SHA-256 is stored.
  Passwords hashed with scrypt. Login attempts are rate-limited.
- **No Docker/Postgres needed locally:** `npm run dev` runs PGlite (Postgres compiled
  to WASM) as the dev database; the tests use it too.
- **Public vs private notes:** public notes are the story text in the PDF; private
  notes are only ever shown to the owner.

## Status

- **Tests:** 65 passing — API (auth, admin, users can't see each other's data, file
  cleanup, sequence, title, cover, story PDF contents, security fixes, sign-in rate limits) and UI (login, album list,
  item page, share dialog).
- **Verified locally:** production build run end to end; sample PDFs rendered and
  checked by eye.
- **Verified in production (2026-11-24):** deployed to the cluster; the UI works in a
  desktop browser and on iPhone, including photo uploads and sharing the story PDF.

## Open items

- **Test a restore** once the first backup has run, so the procedure is proven.

- **HTTPS.** The ingress is plain HTTP, like movietracker, so passwords and notes
  travel unencrypted. Add TLS (cert-manager or a Traefik resolver) before real use —
  the one open item from the security review. On hold (2026-11-24) until the DNS
  records for snowborn.com are under the owner's control again.
- **Secrets at rest.** k3s only encrypts Secrets on disk if started with
  `--secrets-encryption`; worth enabling on the cluster.
- **PDF text limits.** Emoji, and Chinese/Japanese/Korean text, are dropped from the
  PDF because the bundled font can't draw them.
- **PDF photo size.** Capped at ~42% of page height; tune after seeing real albums.
- **Originals aren't kept.** Photos are stored at ≤3000px; full-resolution originals
  would need extra storage.

## Getting started

```bash
cd web
cp .env.example .env
npm install
npm run dev          # http://localhost:5173 — sign in with ADMIN_USERNAME/ADMIN_PASSWORD from .env
npm test
npm run deploy       # deploy to k3s (asks for sudo on the node; first deploy also asks for the admin account)
```
