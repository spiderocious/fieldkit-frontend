// Registers the service worker and surfaces its lifecycle to the app.
//
// A new worker installs beside the running one and then WAITS until every
// tab the old one controls is closed. That is the browser keeping its
// promise that a page built by v1 is never served by v2. We keep that
// promise and offer the user a reload instead of calling skipWaiting()
// behind their back.

export interface ServiceWorkerStatus {
  supported: boolean;
  registered: boolean;
  /** A newer version is installed and waiting for tabs to close. */
  updateReady: boolean;
  /** Reloads once the waiting worker has taken over. */
  applyUpdate: () => void;
}

export function registerServiceWorker(onChange: (s: ServiceWorkerStatus) => void): void {
  const base: ServiceWorkerStatus = { supported: 'serviceWorker' in navigator, registered: false, updateReady: false, applyUpdate: () => undefined };
  if (!base.supported) {
    onChange(base);
    return;
  }

  const url = import.meta.env.DEV ? '/src/sw.ts' : '/sw.js';
  navigator.serviceWorker
    .register(url, { type: 'module', scope: '/' })
    .then((reg) => {
      const applyUpdate = () => {
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      };
      const status = (): ServiceWorkerStatus => ({
        ...base,
        registered: true,
        updateReady: Boolean(reg.waiting && navigator.serviceWorker.controller),
        applyUpdate,
      });
      onChange(status());

      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        fresh?.addEventListener('statechange', () => {
          // installed + an existing controller = a new version is waiting.
          if (fresh.state === 'installed' && navigator.serviceWorker.controller) onChange(status());
        });
      });

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });

      // Ask for Background Sync where it exists. Elsewhere the online event,
      // the timer and app start are the real path; this is a bonus.
      const withSync = reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };
      withSync.sync?.register('drain-outbox').catch(() => undefined);
    })
    .catch(() => onChange({ ...base, registered: false }));
}
