// Wire types copied from the backend. Names stay snake_case so a field on
// the screen can be traced to a column without translation.

export interface SuccessBody<T, M = undefined> {
  data: T;
  meta?: M;
}

export interface ErrorBody {
  error: {
    reason: string;
    message: string;
    /** Numeric band, higher is worse. */
    severity: number;
    field_errors?: Record<string, string[]>;
    data?: unknown;
    request_id: string;
  };
}

export interface PageMeta {
  next_cursor: string | null;
  has_more: boolean;
}

/** Reasons the client branches on. Anything else is shown as its message. */
export const REASON = {
  validation: 'validation_error',
  invalidCredentials: 'invalid_credentials',
  tokenInvalid: 'token_invalid',
  notFound: 'not_found',
  alreadyExists: 'already_exists',
  versionConflict: 'version_conflict',
  idempotencyMismatch: 'idempotency_mismatch',
  payloadTooLarge: 'payload_too_large',
  rateLimited: 'rate_limited',
  chaos: 'chaos_injected',
  internal: 'internal_error',
} as const;
