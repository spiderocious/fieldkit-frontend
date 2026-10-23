// One HTTP client. It unwraps `{ data }`, turns the error envelope into an
// ApiError with the server's reason, and attaches the session token. Every
// feature talks to the server through this file.
import ky, { HTTPError, type KyInstance, type Options } from 'ky';

import { API_BASE } from '@shared/constants/endpoints';
import { readToken } from '@shared/session/session';

import type { ErrorBody, PageMeta, SuccessBody } from './types';

export class ApiError extends Error {
  readonly reason: string;
  readonly status: number;
  readonly fieldErrors: Record<string, string[]>;
  readonly data: unknown;
  readonly retryAfterMs: number | undefined;
  readonly requestId: string | undefined;

  constructor(init: {
    reason: string;
    message: string;
    status: number;
    fieldErrors?: Record<string, string[]>;
    data?: unknown;
    retryAfterMs?: number;
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.reason = init.reason;
    this.status = init.status;
    this.fieldErrors = init.fieldErrors ?? {};
    this.data = init.data;
    this.retryAfterMs = init.retryAfterMs;
    this.requestId = init.requestId;
  }

  /** The request never reached the server or got no answer. Status 0. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Worth sending again later: no answer, server fault, throttled, or timed out. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

/** Builds an ApiError from any failure ky surfaces. */
export async function toApiError(err: unknown): Promise<ApiError> {
  if (err instanceof ApiError) return err;
  if (err instanceof HTTPError) {
    const res = err.response;
    let body: ErrorBody | undefined;
    try {
      body = (await res.clone().json()) as ErrorBody;
    } catch {
      body = undefined;
    }
    const retryAfter = res.headers.get('Retry-After');
    return new ApiError({
      reason: body?.error.reason ?? 'http_error',
      message: body?.error.message ?? `Request failed with ${res.status}`,
      status: res.status,
      ...(body?.error.field_errors && { fieldErrors: body.error.field_errors }),
      data: body?.error.data,
      ...(retryAfter && { retryAfterMs: Number(retryAfter) * 1000 }),
      ...(body?.error.request_id && { requestId: body.error.request_id }),
    });
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new ApiError({ reason: 'timeout', message: 'The server took too long to answer.', status: 0 });
  }
  return new ApiError({ reason: 'network', message: 'Could not reach the server.', status: 0 });
}

export const http: KyInstance = ky.create({
  prefixUrl: API_BASE,
  timeout: 10_000,
  retry: 0, // the outbox owns retries; a request either lands or it does not
  hooks: {
    beforeRequest: [
      (req) => {
        const token = readToken();
        if (token) req.headers.set('Authorization', `Bearer ${token}`);
      },
    ],
  },
});

/** GET that returns `data` only. */
export async function get<T>(path: string, options?: Options): Promise<T> {
  try {
    const body = await http.get(path, options).json<SuccessBody<T>>();
    return body.data;
  } catch (err) {
    throw await toApiError(err);
  }
}

/** GET that also says whether the service worker answered from its cache. */
export async function getWithOrigin<T>(path: string, options?: Options): Promise<{ data: T; fromCache: boolean }> {
  try {
    const res = await http.get(path, options);
    const body = (await res.json()) as SuccessBody<T>;
    return { data: body.data, fromCache: res.headers.get('X-From-Cache') === '1' };
  } catch (err) {
    throw await toApiError(err);
  }
}

/** GET that returns the page and whether the service worker served it from cache. */
export async function getPage<T>(path: string, options?: Options): Promise<{ data: T; meta: PageMeta; fromCache: boolean }> {
  try {
    const res = await http.get(path, options);
    const body = (await res.json()) as SuccessBody<T, PageMeta>;
    return { data: body.data, meta: body.meta ?? { next_cursor: null, has_more: false }, fromCache: res.headers.get('X-From-Cache') === '1' };
  } catch (err) {
    throw await toApiError(err);
  }
}

/** POST JSON. The idempotency key, when given, is the outbox record's. */
export async function post<T>(path: string, json: unknown, idempotencyKey?: string, options?: Options): Promise<T> {
  try {
    const body = await http
      .post(path, { json, ...(idempotencyKey && { headers: { 'Idempotency-Key': idempotencyKey } }), ...options })
      .json<SuccessBody<T>>();
    return body.data;
  } catch (err) {
    throw await toApiError(err);
  }
}

export async function put<T>(path: string, json: unknown, idempotencyKey?: string): Promise<T> {
  try {
    const body = await http
      .put(path, { json, ...(idempotencyKey && { headers: { 'Idempotency-Key': idempotencyKey } }) })
      .json<SuccessBody<T>>();
    return body.data;
  } catch (err) {
    throw await toApiError(err);
  }
}

/** Multipart upload of one file under the `file` field. */
export async function upload<T>(path: string, file: Blob, filename: string, idempotencyKey?: string): Promise<T> {
  const form = new FormData();
  form.append('file', file, filename);
  try {
    const body = await http
      .post(path, { body: form, timeout: 60_000, ...(idempotencyKey && { headers: { 'Idempotency-Key': idempotencyKey } }) })
      .json<SuccessBody<T>>();
    return body.data;
  } catch (err) {
    throw await toApiError(err);
  }
}
