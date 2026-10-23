// Fieldkit end to end, recorded with narration. One continuous session on a
// phone-sized context: sign in, capture a visit online, go offline, capture
// more, reload with no network, come back under a failing API, watch the
// queue retry and drain, then resolve a version conflict.
//
// WEB and API default to the local production previews; set FIELDKIT_WEB
// and FIELDKIT_API to run the same flow against a deployment.
import path from 'node:path';

import { expect, request, test, type APIRequestContext } from '@playwright/test';

import { launch, record, sleep } from './helpers';

const WEB = process.env.FIELDKIT_WEB ?? 'http://localhost:4173';
const API = process.env.FIELDKIT_API ?? 'http://localhost:8090';
const AGENT = { phone: '08030000001', pin: '1234' };
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');

async function chaos(ctx: APIRequestContext, fail_rate: number, mode: '500' | 'timeout' | 'drop' = '500') {
  const res = await ctx.post('/__control', { data: { fail_rate, latency_ms: 0, mode } });
  expect(res.status()).toBe(204);
}

async function api(): Promise<{ ctx: APIRequestContext; token: string }> {
  const ctx = await request.newContext({ baseURL: API });
  // A previous run may have left the API failing on purpose; clear that first.
  await chaos(ctx, 0);
  const res = await ctx.post('/api/v1/auth/login', { data: AGENT });
  expect(res.ok()).toBeTruthy();
  const { data } = (await res.json()) as { data: { token: string } };
  return { ctx, token: data.token };
}

test('fieldkit: online, offline, reload, chaos, conflict', async () => {
  const browser = await launch();
  const { ctx, token } = await api();
  const r = await record(browser, 'fieldkit', { mobile: true, baseURL: WEB });
  const { page, shot, say } = r;
  // Shop names carry a run stamp so the flow can run against a shared server.
  const shops = {
    online: `Iya Basira Provisions ${stamp}`,
    offline1: `Mama Nkechi Stores ${stamp}`,
    offline2: `Alhaji Musa Spare Parts ${stamp}`,
  };

  // ---- title ----------------------------------------------------------------
  await page.goto('/');
  await say.chapter({ n: 0, title: 'Fieldkit', detail: 'A field verification app that keeps working with no signal. One phone, one continuous session.' }, 3200);

  // ---- sign in -----------------------------------------------------------
  await say.chapter({ n: 1, title: 'Sign in once', detail: 'The token is kept on the device, so a reload with no signal still has a session.' });
  await say.caption('Signing in as agent Ayomide Bello');
  await expect(page.getByRole('heading', { name: 'Fieldkit' })).toBeVisible();
  await shot('login');
  await page.getByLabel('Phone').fill(AGENT.phone);
  await page.getByLabel('PIN').fill(AGENT.pin);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('status-strip')).toHaveAttribute('data-online', 'true');
  await expect(page.getByTestId('visit-row').first()).toBeVisible();
  await say.result('Online. The status strip reports what a real probe said, not navigator.onLine.');
  await shot('home-online-seeded');

  // ---- create a visit online, with a photo compressed in a worker -------
  await say.chapter({
    n: 2,
    title: 'Capture a visit with signal',
    detail: 'The photo is decoded and compressed in a Web Worker, stored in OPFS, and the visit is queued as an intent. The UI never waits on the network.',
    term: 'Web Worker · OPFS · outbox pattern · Idempotency-Key',
  });
  await say.caption('Filling the form and adding a 12 MP photo');
  await page.getByRole('link', { name: 'New visit' }).click();
  await page.getByLabel('Shop name').fill(shops.online);
  await page.getByLabel('Owner name').fill('Basira Adewale');
  await page.getByLabel('Owner phone').fill('08031112222');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByTestId('location')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(path.join(FIXTURES, 'shop-front.jpg'));
  await expect(page.getByText(/KB · ready/)).toBeVisible();
  await say.result('Compressed off the main thread: a 12 MP photo is now a few hundred kilobytes.');
  await shot('new-visit-filled-online');
  await say.caption('Saving. The form returns as soon as IndexedDB has it; sending happens in the background.');
  await page.getByRole('button', { name: 'Save visit' }).click();
  const first = page.getByTestId('visit-row').filter({ hasText: shops.online });
  await expect(first).toHaveAttribute('data-sync-state', 'synced');
  await say.result('Synced. The create and the photo upload each carried their own idempotency key.');
  await shot('home-first-visit-synced');

  // ---- airplane mode ------------------------------------------------------
  await say.chapter({
    n: 3,
    title: 'Airplane mode',
    detail: 'The network is gone. Two more visits are captured; each save touches only the device database and the outbox.',
    term: 'IndexedDB · outbox · probe says offline',
  });
  await r.context.setOffline(true);
  await say.caption('Opening the sync panel and probing the server by hand');
  await page.getByTestId('status-strip').click();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('probe-state')).toHaveText('no connection');
  await say.result('The probe failed, so the app knows it is offline. It did not trust the browser flag.');
  await shot('sync-panel-offline');
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByTestId('status-strip')).toHaveAttribute('data-online', 'false');

  for (const [i, v] of [
    [shops.offline1, 'Nkechi Eze', '08033334444'],
    [shops.offline2, 'Musa Ibrahim', '08035556666'],
  ].entries()) {
    await say.caption(i === 0 ? 'Visit two, with a photo, no signal' : 'Visit three, no signal');
    await page.getByRole('link', { name: 'New visit' }).click();
    await page.getByLabel('Shop name').fill(v[0]!);
    await page.getByLabel('Owner name').fill(v[1]!);
    await page.getByLabel('Owner phone').fill(v[2]!);
    if (i === 0) {
      await page.locator('input[type=file]').setInputFiles(path.join(FIXTURES, 'shelf.jpg'));
      await expect(page.getByText(/KB · ready/)).toBeVisible();
      await shot('new-visit-offline-with-photo');
    }
    await page.getByRole('button', { name: 'Save visit' }).click();
    await expect(page.getByTestId('visit-row').filter({ hasText: v[0]! })).toHaveAttribute('data-sync-state', 'pending');
  }
  await expect(page.getByTestId('pending-count')).toHaveText('3 waiting to send'); // 2 visits + 1 photo
  await say.result('3 waiting to send: two visits and one photo. Nothing was lost, nothing was sent.');
  await shot('home-offline-two-pending');

  // ---- reload with no network: the service worker serves the shell -------
  await say.chapter({
    n: 4,
    title: 'Reload with no network',
    detail: 'The service worker answers the navigation from Cache Storage. The list comes from IndexedDB and the photo from OPFS.',
    term: 'service worker · cache-first shell · storage tiers',
  });
  await say.caption('Reloading the page while offline');
  await page.reload();
  await expect(page.getByTestId('visit-row').filter({ hasText: shops.offline1 })).toBeVisible();
  await expect(page.getByTestId('status-strip')).toHaveAttribute('data-online', 'false');
  await say.result('Back in under a second, still offline, queue intact.');
  await shot('home-reloaded-offline');
  await say.caption('Opening the offline visit: the photo is read from the device');
  await page.getByTestId('visit-row').filter({ hasText: shops.offline1 }).click();
  await expect(page.getByText('on this phone')).toBeVisible();
  await say.result('The photo badge says "on this phone": bytes in OPFS, not yet on the server.');
  await shot('detail-offline-photo-on-device');
  await page.getByRole('link', { name: 'Back' }).click();

  // ---- back online, but the API is failing: retries with backoff ----------
  await say.chapter({
    n: 5,
    title: 'Signal returns, but the API is failing',
    detail: 'The server is told to fail every request. The queue retries with exponential backoff and jitter. The idempotency key on each record never changes.',
    term: 'POST /__control { fail_rate: 1 } · backoff · jitter',
  });
  await chaos(ctx, 1, '500');
  await r.context.setOffline(false);
  await say.caption('Reconnected. The online event triggered a drain; every request got a 500.');
  await page.getByTestId('status-strip').click();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('retrying-row').filter({ hasText: 'New visit' }).first()).toContainText(/Attempt [1-9] · Server error/);
  await say.result('Each record shows its attempt count, the server reason, its key, and when it will try again.', 2600);
  await shot('sync-panel-chaos-retrying');

  // ---- API recovers: the queue drains ------------------------------------
  await say.chapter({
    n: 6,
    title: 'The API recovers',
    detail: 'fail_rate back to 0. "Sync now" sends everything pending at once, ignoring the backoff timers, because a person asked.',
    term: 'forced drain · one tab holds the Web Lock',
  });
  await chaos(ctx, 0);
  await say.caption('Sync now');
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('stat-pending')).toHaveText('0');
  await expect(page.getByTestId('stat-failed')).toHaveText('0');
  await say.result('0 waiting, 0 failed. Three records, three keys, each posted exactly once.');
  await shot('sync-panel-drained');
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByTestId('visit-row').filter({ hasText: shops.offline1 })).toHaveAttribute('data-sync-state', 'synced');
  await expect(page.getByTestId('visit-row').filter({ hasText: shops.offline2 })).toHaveAttribute('data-sync-state', 'synced');
  await say.result('Every visit is Synced.');
  await shot('home-all-synced');

  // ---- version conflict: another device edits first -----------------------
  await say.chapter({
    n: 7,
    title: 'Someone else edited the same visit',
    detail: 'A second device updates the owner name first. Our edit carries the version we read, so the server answers 409 with its copy and the agent decides.',
    term: 'base_version · 409 version_conflict · keep mine / take theirs',
  });
  const list = await ctx.get('/api/v1/visits?limit=50', { headers: { Authorization: `Bearer ${token}` } });
  const visits = ((await list.json()) as { data: { id: string; shop_name: string; version: number }[] }).data;
  const target = visits.find((v) => v.shop_name === shops.offline1);
  expect(target).toBeTruthy();
  const put = await ctx.put(`/api/v1/visits/${target!.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { base_version: target!.version, owner_name: 'Nkechi Eze-Okafor' },
  });
  expect(put.ok()).toBeTruthy();

  await say.caption('Another device changed the owner name. We edit the phone number on top of the old version.');
  await page.getByTestId('visit-row').filter({ hasText: shops.offline1 }).click();
  await page.getByLabel('Owner phone').fill('08039990000');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('conflict-panel')).toBeVisible();
  await say.warn('409 from the server. Both copies are shown side by side.', 2400);
  await shot('detail-version-conflict');
  await say.caption('Keep mine: the same fields are sent again against the server’s version');
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByTestId('visit-state')).toHaveText('Synced');
  await say.result('Synced at version 3. No silent overwrite in either direction.');
  await shot('detail-conflict-resolved');

  // ---- the room's view -----------------------------------------------------
  await say.chapter({ n: 8, title: 'What the server received', detail: 'The ops view polls the server. Every visit from this session is counted, once.' });
  await page.goto('/ops');
  await expect(page.getByTestId('ops-total')).not.toHaveText('…');
  await say.caption('Totals and the per-agent breakdown, straight from Postgres');
  await sleep(1500);
  await shot('ops-server-view');

  await say.outro('That was Fieldkit', [
    'Writes go to the device first; the outbox sends them later.',
    'One idempotency key per intent, kept across every retry.',
    'A real probe decides "online"; backoff with jitter decides "when".',
    'Versions make conflicts visible instead of silent.',
  ]);
  await r.finish('fieldkit-demo');
  await ctx.dispose();
  await browser.close();
});
