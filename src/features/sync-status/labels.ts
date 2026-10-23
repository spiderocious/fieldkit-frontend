// Plain words for what the queue is doing. People see these; the codes stay
// in the logs.
const reasons: Record<string, string> = {
  network: 'No connection',
  timeout: 'Server took too long',
  http_error: 'Server error',
  internal_error: 'Server error',
  chaos_injected: 'Server error',
  rate_limited: 'Too many requests',
  validation_error: 'Invalid details',
  version_conflict: 'Changed elsewhere',
  attempts_exhausted: 'Gave up after repeated failures',
  insufficient_balance: 'Not enough balance',
  recipient_not_found: 'No wallet with that username',
  self_transfer: 'Cannot send to yourself',
  idempotency_mismatch: 'Could not be verified',
  visit_not_synced: 'Waiting for the visit to send',
  photo_missing_on_device: 'Photo missing on this phone',
};

const intents: Record<string, string> = {
  'transfer.send': 'Transfer',
  'visit.create': 'New visit',
  'visit.update': 'Edit',
  'photo.upload': 'Photo',
};

export function reasonLabel(reason: string | undefined): string {
  if (!reason) return 'Waiting';
  return reasons[reason] ?? 'Could not be sent';
}

export function intentLabel(type: string): string {
  return intents[type] ?? type;
}
