// Sends a batch of buffered events. With keepalive the request outlives a
// closing tab, which is how a "last breath" flush works on mobile.
import { post } from '@shared/api/client';
import { EP } from '@shared/constants/endpoints';
import type { TelemetryRecord } from '@shared/offline';
import { readToken } from '@shared/session/session';

interface BatchResponse {
  accepted: number;
  skipped: number;
}

export async function shipTelemetry(events: TelemetryRecord[], keepalive: boolean): Promise<boolean> {
  if (!readToken()) return false;
  try {
    await post<BatchResponse>(
      EP.telemetry,
      { events: events.map((e) => ({ kind: e.kind, payload: e.payload, occurred_at: e.occurredAt })) },
      undefined,
      { keepalive, timeout: keepalive ? 5000 : 10_000 },
    );
    return true;
  } catch {
    return false;
  }
}
