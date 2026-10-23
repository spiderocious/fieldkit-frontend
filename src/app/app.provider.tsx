// Wires the three long-lived objects: the query client (server reads), the
// offline runtime (queue, sync, telemetry) and the service worker. Nothing
// here is a global store; the offline runtime is reached through context.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { shipTelemetry } from '@features/sync-status/ship-telemetry';
import { sendVisitIntent } from '@features/visits/visits.sender';
import { PROBE_URL } from '@shared/constants/endpoints';
import { FieldkitDb } from '@shared/db/fieldkit-db';
import { createOffline, registerServiceWorker, requestPersistence, type Offline, type ServiceWorkerStatus, type SyncState } from '@shared/offline';
import { loadSession } from '@shared/session/session';

export interface OfflineContextValue {
  offline: Offline;
  db: FieldkitDb;
  sync: SyncState;
  sw: ServiceWorkerStatus;
  persisted: boolean | null;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // the service worker and the outbox own retries
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  },
});

interface Props {
  children: ReactNode;
  /** Test seam: a database and runtime built by the test. */
  db?: FieldkitDb;
}

export function AppProvider({ children, db: injectedDb }: Readonly<Props>) {
  const db = useMemo(() => injectedDb ?? new FieldkitDb(), [injectedDb]);
  const offline = useMemo(
    () =>
      createOffline({
        db,
        probeUrl: PROBE_URL,
        lockName: 'fieldkit-outbox',
        ordered: false, // visits are independent; a stuck one must not block the rest
        send: (record) => sendVisitIntent(db, record),
        ship: shipTelemetry,
      }),
    [db],
  );
  const [sync, setSync] = useState<SyncState>(offline.sync.getState());
  const [sw, setSw] = useState<ServiceWorkerStatus>({ supported: false, registered: false, updateReady: false, applyUpdate: () => undefined });
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = offline.sync.subscribe(setSync);
    (async () => {
      await loadSession(db);
      if (cancelled) return;
      setBooted(true);
      await offline.start();
      const p = await requestPersistence();
      if (!cancelled) setPersisted(p);
      void offline.telemetry.track('app.start', { persisted: p });
    })();
    if (!import.meta.env.VITEST) registerServiceWorker(setSw);
    return () => {
      cancelled = true;
      unsubscribe();
      offline.stop();
    };
  }, [db, offline]);

  const value = useMemo<OfflineContextValue>(() => ({ offline, db, sync, sw, persisted }), [offline, db, sync, sw, persisted]);

  if (!booted) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
    </QueryClientProvider>
  );
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used inside AppProvider');
  return ctx;
}
