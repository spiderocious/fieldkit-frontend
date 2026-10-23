# fieldkit-frontend

Field verification that works with no signal. Built for the DevFest Akure 2026 workshop *Designing Offline Enabled Data Intensive Web Apps: Web Workers, Cache Strategy, Storage Tiers, Sync, Queues, and Runtime Observability*.

Live: https://devfest-akure-fieldkit.netlify.app (sign in `08030000001` / `1234`). API: [fieldkit-backend](https://github.com/spiderocious/fieldkit-backend). Sibling demo: [wallet-frontend](https://github.com/spiderocious/wallet-frontend).

Demo recording: [qa/artifacts/videos/fieldkit-demo.mp4](qa/artifacts/videos/fieldkit-demo.mp4). Screenshots in [qa/artifacts/screenshots](qa/artifacts/screenshots).

## How a visit travels

```
form submit ──▶ IndexedDB (visits, photos) + OPFS (bytes) + outbox (intents)
                      │
   online event / timer / app start / "Sync now" / Background Sync
                      ▼
              sync engine (Web Lock, one tab at a time)
                      │ probe GET /api/v1/ping
                      ▼
      visit.create ──▶ POST /visits        (Idempotency-Key = record key)
      photo.upload ──▶ POST /visits/:id/photos
      visit.update ──▶ PUT  /visits/:id    (base_version → 409 on conflict)
```

Retryable failures (no answer, 5xx, 429 with Retry-After) back off with jitter and keep the same key. Final failures stop and show their reason. A 409 parks the record with the server's copy so the person can choose.

## Map

```
src/
  app/                  router, provider (query client + offline runtime + service worker)
  shared/offline/       the core: db, outbox, sync, backoff, storage, photos, compress worker, telemetry, SW registration
  shared/api/           ky client, error envelope → ApiError
  shared/db/            FieldkitDb: core stores + visits + photos
  shared/session/       token in memory, mirrored to IndexedDB
  features/auth         sign in
  features/visits       list, new, detail, sender (intent → HTTP), repo (local writes)
  features/sync-status  status strip, sync panel, telemetry shipping
  features/ops          the room's view of the server
  sw.ts                 service worker: cache-first shell, network-first API reads, streams untouched
qa/                     Playwright flow that records the demo with narration
```

`src/shared/offline/`, `src/sw.ts` and `src/shared/api/client.ts` are copied verbatim into wallet-frontend. `CORE_CHECKSUM` pins the copy; `scripts/check-core.sh` fails CI when it drifts.

## Run

```sh
pnpm install
pnpm dev          # :5173, proxies /api and /__control to the backend on :8090
pnpm test         # vitest
pnpm lint && pnpm typecheck && pnpm build
```

Production build + preview: `pnpm build && pnpm preview` (:4173). The demo recording: `cd qa && pnpm test && pnpm render` with the backend and the preview running (see [qa/playwright.config.ts](qa/playwright.config.ts); set `FIELDKIT_WEB` and `FIELDKIT_API` to run it against a deployment).

## Deploy

`netlify.toml` serves `dist`, proxies `/api/*` and `/__control` to the Railway backend so the app stays same-origin with its API, falls back to `index.html`, and keeps `sw.js` and `precache.json` uncached.

## Known limits

- Safari evicts an origin's storage after seven days without a visit unless `persist()` is granted; the panel shows whether it was.
- Background Sync exists in Chromium only; the online event, the timer and app start do the work elsewhere.
- Device memory and Save-Data hints are Chromium only; an unknown value takes the conservative photo budget by design.
- Photos are capped at 2 MB on the server and compressed on the device to a budget of 0.6 or 1.5 MB.
