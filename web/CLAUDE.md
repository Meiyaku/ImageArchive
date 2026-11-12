# CLAUDE.md

## Project overview

Image Archive: a private, multi-user photo archive. Users sign in (accounts are
created by an admin — there is no self sign-up), manage named albums, and add items
to albums. Each item is an image plus **public notes** and **private notes** (both
plain text), an optional **title** (≤200 chars, `''` = none), and a **sequence** number that orders the album grid (ascending, ties by
id; duplicates allowed). Left blank on create, it becomes the album's max + 1, so items
count up from 1; cleared on edit, it keeps its current value. Albums have an optional
**intro** and **cover photo** (its own files, set by upload or copied from one of the
album's items), and can be shared as a **story PDF**. Deployed to k3s at `imagearchive.snowborn.com`.

One Node process serves both the JSON API (`/api/*`) and the built React client.
Postgres holds users, sessions, albums and items; image files live on a volume
(`UPLOAD_DIR`) and are only served through ownership-checked API routes.

## Commands

```bash
cp .env.example .env   # first time
npm run dev            # PGlite dev DB on :5432 + API on :3000 (watch) + Vite on :5173
npm run build          # tsc -b (client + server) && vite build → dist/
npm start              # production server (set STATIC_DIR=dist to serve the client)
npm test               # vitest: server API tests + client component tests
npm run lint
npm run typecheck
npm run create-user -- <username> <password> [--admin]
scripts/deploy.sh      # build on the k3s node and roll out (see Deploy)
```

No Docker or Postgres is needed locally: `npm run dev:db` runs PGlite (Postgres
compiled to WASM) behind the Postgres wire protocol, persisted in `.devdb/`. Server
tests do the same in-memory per test file (`server/testing.ts`).

## Architecture

```
server/                 — Express 5 API, run as TypeScript via Node's type stripping (no build)
├── index.ts            — boot: wait for DB, migrate, bootstrap admin, listen
├── app.ts              — createApp({pool, uploadDir, staticDir}); used by tests too
├── db.ts               — pg Pool + migration runner (migrations/NNN_*.sql, advisory lock)
├── auth.ts             — session cookies, requireUser/requireAdmin, Origin check, login limiter
├── users.ts            — createUser / bootstrapAdmin / validation
├── password.ts         — scrypt hashing (node:crypto, no native deps)
├── storage.ts          — sharp: normalise uploads to JPEG + thumbnail, delete files
├── upload.ts           — multer config + storeUpload (shared by items and album covers)
├── story.ts            — story PDF renderer (pdfkit + DejaVu fonts)
├── routes/             — auth, admin (user management), albums, items
└── cli/create-user.ts
src/                    — React 19 + Vite + Tailwind 4 + react-router 7
├── api/client.ts       — all fetch calls; uploads use XHR for progress
├── context/AuthContext — current user, login/logout
├── hooks/              — one data hook per page (useAlbums, useAlbum, useItemEditor, useAdminUsers)
├── pages/              — Login, Albums (list + ⋯ rename/delete menu), Album (grid), Item (read-only view → Edit; new items open in the form), Admin, Account
├── components/         — Layout, Modal (<dialog>), AlbumMenu (⋯: Edit/Share/Delete), EditAlbumDialog
│                         (name, cover, intro), ShareStoryDialog, AlbumDialogs, ImagePicker, icons
└── lib/prepareImage.ts — client-side downscale/re-encode before upload
```

**Page/hook split**: pages are JSX + local UI state; data loading and mutations live
in the page's hook. Hooks call `api`; components never call `fetch` directly.

### Server conventions

- Server imports use explicit `.ts` extensions and only erasable TS syntax
  (`erasableSyntaxOnly`) — no enums, namespaces, or constructor parameter properties.
- Every album/item query is scoped by `user_id = req.user.id`; a non-owned resource
  returns 404 (not 403) so ids don't leak. Keep it that way for new routes.
- Schema changes: add a new `server/migrations/NNN_name.sql`; never edit an applied one.
- Express 5 forwards async errors to the error handler; throw `Object.assign(new Error(msg), { status })`
  for client-facing errors.

### Auth

- Opaque random session token in an httpOnly, SameSite=Lax cookie; the DB stores its
  SHA-256. Sessions last 30 days. Admin password resets delete the user's sessions.
- The first admin is created at startup from `ADMIN_USERNAME`/`ADMIN_PASSWORD` only
  when the users table is empty. Further accounts: the in-app **Manage users** page
  (admins only) or `create-user`.

### Images (iOS)

- `ImagePicker` is a `<label>` around a visually hidden `<input type="file" accept="image/*">`
  with no `capture`, so iOS offers Photo Library / Take Photo / Choose File.
- `prepareImage` decodes the pick in the browser (Safari handles HEIC), draws it to a
  canvas at ≤2560px and uploads JPEG. This is what makes iPhone HEIC photos work —
  sharp's prebuilt binaries can't decode HEIC. If the browser can't decode, the
  original file is sent and sharp tries.
- Server stores a ≤3000px JPEG and a 600px square thumbnail, both EXIF-rotated.
  File names are random UUIDs; URLs carry `?v=<key>` so they're cached immutably.

### Story PDF

`GET /api/albums/:id/story.pdf[?cover=1]` streams a US Letter PDF: optional cover page
(name, cover photo, intro), then items in sequence order as a continuous flow —
photo, title, public notes. **Private notes are never selected for it.** Layout rules
in `story.ts`: a photo and its title are never split across pages (photos capped at
42% of page height so items can share a page); notes flow; story pages are numbered.
Characters the DejaVu fonts can't draw (emoji, CJK) are dropped via fontkit rather
than rendered as boxes. Photos are re-encoded to ≤1600px for a shareable file size.

Client side, `ShareStoryDialog` is deliberately two taps (Create PDF → Share) because
iOS only allows `navigator.share` straight after a tap; it falls back to a download
where file sharing isn't supported. Tests read PDFs back with pdfjs-dist.

## Deploy (k3s)

`scripts/deploy.sh` (from `web/`) mirrors movietracker: tars the source to
`sb@k3s.snowborn.com` (override `DEPLOY_HOST`/`DEPLOY_USER`), builds with the node's
Docker, pushes `localhost:5000/imagearchive:<sha>`, appends a Kustomize `images:`
entry, and runs `sudo k3s kubectl apply -k`. Namespace `imagearchive`.

- `k8s/postgres.yaml` — Postgres 17 StatefulSet with a 5Gi PVC.
- `k8s/app.yaml` — app Deployment (Recreate strategy; RWO volume), 50Gi uploads PVC,
  Service, Traefik Ingress for `imagearchive.snowborn.com`.
- Secret `imagearchive-secrets` (`POSTGRES_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`)
  is created by the deploy script on first run and is not in git.

Create a user in the cluster:
`sudo k3s kubectl -n imagearchive exec deploy/imagearchive -- node server/cli/create-user.ts <user> <pass>`
