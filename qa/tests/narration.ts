// Narration overlays for the recordings, drawn in the deck's style. The
// harness injects a tiny script into every page load that can draw three
// things: a full-screen chapter card, a persistent caption bar for the step
// in progress, and a result caption. Nothing here touches the app code.
import type { Page } from '@playwright/test';

export interface ChapterCard {
  /** Chapter number, shown in a pill. 0 draws a title card. */
  n: number;
  title: string;
  detail?: string;
  /** Small line under the detail: the talk's term for what is on screen. */
  term?: string;
}

const OVERLAY_SCRIPT = `
(() => {
  if (window.__demo) return;
  const INK = '#1e1e1e', OFF = '#f0f0f0', BLUE = '#4285f4', GREEN_P = '#ccf6c5', YELLOW_P = '#ffe7a5', RED_P = '#f8d8d8';
  const font = "'Google Sans Flex', system-ui, sans-serif";
  const mono = "'Roboto Mono', ui-monospace, monospace";
  const root = () => {
    let r = document.getElementById('__demo_root');
    if (!r) {
      r = document.createElement('div');
      r.id = '__demo_root';
      r.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:' + font + ';';
      document.documentElement.appendChild(r);
    }
    return r;
  };
  const fade = (el, show) => { el.style.transition = 'opacity 320ms ease'; requestAnimationFrame(() => { el.style.opacity = show ? '1' : '0'; }); };
  window.__demo = {
    card({ n, title, detail, term, compact }) {
      const r = root();
      const old = r.querySelector('.__card'); if (old) old.remove();
      const c = document.createElement('div');
      c.className = '__card';
      c.style.cssText = 'position:absolute;inset:0;background:' + OFF + ';color:' + INK + ';display:flex;flex-direction:column;justify-content:center;padding:' + (compact ? '0 40px' : '0 32px') + ';opacity:0;';
      const pill = n > 0
        ? '<div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:' + (compact ? 14 : 22) + 'px"><span style="background:' + BLUE + ';color:#fff;border:2.5px solid ' + INK + ';border-radius:999px;padding:6px 16px;font-weight:600;font-size:' + (compact ? 16 : 18) + 'px">' + n + '</span><span style="font-family:' + mono + ';font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#52555a">step</span></div>'
        : '<div style="font-family:' + mono + ';font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#52555a;margin-bottom:18px">DevFest Akure 2026 · demo</div>';
      c.innerHTML = pill
        + '<div style="font-size:' + (compact ? 34 : (n > 0 ? 34 : 40)) + 'px;line-height:1.1;font-weight:700;letter-spacing:-.01em">' + title + '</div>'
        + (detail ? '<div style="margin-top:16px;font-size:' + (compact ? 17 : 19) + 'px;line-height:1.45;color:#52555a;max-width:620px">' + detail + '</div>' : '')
        + (term ? '<div style="margin-top:22px;display:inline-block;background:#fff;border:2.5px solid ' + INK + ';border-radius:14px;padding:10px 14px;font-family:' + mono + ';font-size:13px;max-width:620px">' + term + '</div>' : '');
      r.appendChild(c); fade(c, true);
    },
    uncard() { const c = root().querySelector('.__card'); if (c) { fade(c, false); setTimeout(() => c.remove(), 360); } },
    caption({ text, tone, position }) {
      const r = root();
      const old = r.querySelector('.__cap'); if (old) old.remove();
      const bg = tone === 'result' ? GREEN_P : tone === 'warn' ? YELLOW_P : tone === 'bad' ? RED_P : INK;
      const fg = tone ? INK : '#fff';
      const b = document.createElement('div');
      b.className = '__cap';
      b.style.cssText = 'position:absolute;left:0;right:0;' + (position === 'top' ? 'top:0' : 'bottom:0') + ';background:' + bg + ';color:' + fg + ';padding:14px 20px;font-size:17px;line-height:1.35;font-weight:500;opacity:0;border-top:2.5px solid ' + INK + ';';
      b.textContent = text;
      r.appendChild(b); fade(b, true);
    },
    uncaption() { const c = root().querySelector('.__cap'); if (c) { fade(c, false); setTimeout(() => c.remove(), 360); } },
    hide() { const r = root(); r.style.visibility = 'hidden'; },
    show() { const r = root(); r.style.visibility = 'visible'; },
  };
})();`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Narrator {
  /** Full-screen chapter card, held for a beat, then faded out. */
  chapter(card: ChapterCard, holdMs?: number): Promise<void>;
  /** Persistent bar describing the action in progress. */
  caption(text: string, position?: 'top' | 'bottom'): Promise<void>;
  /** Green bar stating what just happened, held for a beat. */
  result(text: string, holdMs?: number): Promise<void>;
  warn(text: string, holdMs?: number): Promise<void>;
  /** Hides overlays for a screenshot and restores them after. */
  hidden<T>(fn: () => Promise<T>): Promise<T>;
  /** Closing card that stays until the recording ends. */
  outro(title: string, lines: string[], holdMs?: number): Promise<void>;
}

/**
 * Attaches the overlay script to the page (survives reloads) and returns
 * the narrator. `compact` is for the wide stage view, where cards are
 * smaller.
 */
export async function narrator(page: Page, opts: { compact?: boolean } = {}): Promise<Narrator> {
  await page.addInitScript(OVERLAY_SCRIPT);
  // If the page is already loaded, inject now as well.
  await page.evaluate(OVERLAY_SCRIPT).catch(() => undefined);
  const compact = opts.compact ?? false;
  const run = (fn: string, arg?: unknown) => page.evaluate(`window.__demo && window.__demo.${fn}(${JSON.stringify(arg ?? {})})`).catch(() => undefined);
  return {
    async chapter(card, holdMs = compact ? 2200 : 2800) {
      await run('uncaption');
      await run('card', { ...card, compact });
      await wait(holdMs);
      await run('uncard');
      await wait(400);
    },
    async caption(text, position = 'bottom') {
      await run('caption', { text, position });
    },
    async result(text, holdMs = 1800) {
      await run('caption', { text, tone: 'result', position: 'bottom' });
      await wait(holdMs);
    },
    async warn(text, holdMs = 1800) {
      await run('caption', { text, tone: 'warn', position: 'bottom' });
      await wait(holdMs);
    },
    async hidden(fn) {
      await run('hide');
      try {
        return await fn();
      } finally {
        await run('show');
      }
    },
    async outro(title, lines, holdMs = 4000) {
      await run('uncaption');
      await run('card', { n: 0, title, detail: lines.join('<br>'), compact });
      await wait(holdMs);
    },
  };
}
