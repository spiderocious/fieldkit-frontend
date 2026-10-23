import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

import { chromium, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { narrator, type Narrator } from './narration';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const OUT = path.join(ROOT, 'artifacts');

export interface Recorder {
  context: BrowserContext;
  page: Page;
  /** Chapter cards and captions drawn over the page for the recording. */
  say: Narrator;
  /** Takes a numbered, named screenshot into artifacts/<app>/screenshots. */
  shot: (name: string) => Promise<void>;
  /** Closes the context and renames the recording to artifacts/<app>/videos/<name>.webm. */
  finish: (videoName: string) => Promise<void>;
}

/** A browser context that records video and numbers its screenshots. */
export async function record(browser: Browser, app: string, opts: { mobile?: boolean; baseURL: string; prefix?: string }): Promise<Recorder> {
  const shots = path.join(OUT, 'screenshots');
  const videos = path.join(OUT, 'videos');
  mkdirSync(shots, { recursive: true });
  mkdirSync(videos, { recursive: true });
  const device = opts.mobile ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } };
  // The recording must match the viewport exactly or the frame gets a bar.
  const size = device.viewport ?? { width: 1440, height: 900 };
  const context = await browser.newContext({
    ...device,
    baseURL: opts.baseURL,
    recordVideo: { dir: path.join(OUT, 'raw-video'), size },
    serviceWorkers: 'allow',
    permissions: opts.mobile ? ['geolocation'] : [],
    geolocation: { latitude: 7.2571, longitude: 5.2058 },
  });
  const page = await context.newPage();
  let n = 0;
  const prefix = opts.prefix ?? '';
  const say = await narrator(page, { compact: !opts.mobile });
  return {
    context,
    page,
    say,
    shot: async (name) => {
      n += 1;
      // Screenshots are the clean product shots; the narration is for the video.
      await say.hidden(() => page.screenshot({ path: path.join(shots, `${prefix}${String(n).padStart(2, '0')}-${name}.png`), fullPage: false }));
    },
    finish: async (videoName) => {
      const video = page.video();
      await context.close();
      if (video) {
        const p = await video.path();
        renameSync(p, path.join(videos, `${videoName}.webm`));
      }
    },
  };
}

export async function launch(): Promise<Browser> {
  // slowMo makes the recordings watchable: every click lands ~350ms apart.
  return chromium.launch({ slowMo: 350 });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
