// The one-line truth under the header: are we online (by probe, not by
// navigator.onLine), how many intents wait, and whether a new version of
// the app is ready.
import { Show } from 'meemaw';
import { Link } from 'react-router-dom';

import { useOffline } from '@app/app/app.provider';
import { Cloud, CloudOff, Loader2, WifiOff } from '@icons';
import { ROUTES } from '@shared/constants/routes';

import { useOutboxStats } from './use-outbox-stats';

export function StatusStrip() {
  const { sync, sw } = useOffline();
  const stats = useOutboxStats();
  const waiting = stats.pending + stats.inflight;
  const attention = stats.failed + stats.conflicted;

  const tone = sync.online === false ? 'bg-ink text-white' : sync.draining ? 'bg-blue-pastel text-ink' : 'bg-green-pastel text-ink';
  const label = sync.online === null ? 'Checking connection' : sync.online ? (sync.draining ? 'Syncing' : 'Online') : 'Offline';
  const Icon = sync.online === false ? WifiOff : sync.draining ? Loader2 : sync.online ? Cloud : CloudOff;

  return (
    <div className="flex flex-col">
      <Link to={ROUTES.sync} className={`flex h-9 items-center gap-2 px-4 text-sm ${tone}`} data-testid="status-strip" data-online={String(sync.online)}>
        <Icon className={`size-4 ${sync.draining ? 'animate-spin' : ''}`} aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="flex-1" />
        <Show when={waiting > 0}>
          <span data-testid="pending-count">{waiting} waiting to send</span>
        </Show>
        <Show when={attention > 0}>
          <span className="rounded-full bg-red px-2 py-0.5 text-xs text-white">{attention} need attention</span>
        </Show>
        <Show when={waiting === 0 && attention === 0}>
          <span className="opacity-80">All sent</span>
        </Show>
      </Link>
      <Show when={sw.updateReady}>
        <div className="flex h-9 items-center gap-2 bg-yellow-pastel px-4 text-sm text-ink">
          <span className="flex-1">A new version is ready.</span>
          <button type="button" onClick={sw.applyUpdate} className="font-medium underline">
            Reload now
          </button>
        </div>
      </Show>
    </div>
  );
}
