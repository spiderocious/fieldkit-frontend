// Turns an outbox intent into HTTP and the answer into a SendResult. This is
// the only place the queue meets the network for this feature. On success it
// also folds the server's answer back into the local store.
import { ApiError } from '@shared/api/client';
import { REASON } from '@shared/api/types';
import type { FieldkitDb } from '@shared/db/fieldkit-db';
import { getPhoto, type OutboxRecord, type SendResult } from '@shared/offline';

import { createVisit, getVisit, updateVisit, uploadPhoto, type Visit } from './visits.api';
import { INTENT, type CreateVisitPayload, type UpdateVisitPayload, type UploadPhotoPayload } from './visits.intents';

/** Maps a failed request to what the queue should do with the record. */
export function toSendResult(err: unknown): SendResult {
  if (!(err instanceof ApiError)) {
    return { ok: false, retry: true, reason: err instanceof Error ? err.name : 'unknown' };
  }
  if (err.reason === REASON.versionConflict) {
    return { ok: false, retry: false, reason: err.reason, conflict: err.data };
  }
  if (err.isRetryable) {
    return { ok: false, retry: true, reason: err.reason, ...(err.retryAfterMs !== undefined && { retryAfterMs: err.retryAfterMs }) };
  }
  return { ok: false, retry: false, reason: err.reason };
}

async function applyServerVisit(db: FieldkitDb, v: Visit): Promise<void> {
  await db.visits.update(v.id, {
    version: v.version,
    photo_count: v.photo_count,
    created_at: v.created_at,
    updated_at: v.updated_at,
  });
}

export async function sendVisitIntent(db: FieldkitDb, record: OutboxRecord): Promise<SendResult> {
  switch (record.type) {
    case INTENT.createVisit:
      return sendCreate(db, record);
    case INTENT.updateVisit:
      return sendUpdate(db, record);
    case INTENT.uploadPhoto:
      return sendPhoto(db, record);
    default:
      return { ok: false, retry: false, reason: 'unknown_intent' };
  }
}

async function sendCreate(db: FieldkitDb, record: OutboxRecord): Promise<SendResult> {
  const body = record.payload as CreateVisitPayload;
  try {
    const v = await createVisit(body, record.idempotencyKey);
    await applyServerVisit(db, v);
    return { ok: true };
  } catch (err) {
    // Same id, different key: the server already has this visit (a previous
    // attempt landed and the key was lost). Treat the server's copy as truth.
    if (err instanceof ApiError && err.reason === REASON.alreadyExists) {
      try {
        await applyServerVisit(db, await getVisit(body.id));
        return { ok: true };
      } catch (inner) {
        return toSendResult(inner);
      }
    }
    return toSendResult(err);
  }
}

async function sendUpdate(db: FieldkitDb, record: OutboxRecord): Promise<SendResult> {
  const { visit_id, fields } = record.payload as UpdateVisitPayload;
  if (record.baseVersion === undefined) return { ok: false, retry: false, reason: 'missing_base_version' };
  try {
    const v = await updateVisit(visit_id, { base_version: record.baseVersion, ...fields }, record.idempotencyKey);
    await applyServerVisit(db, v);
    return { ok: true };
  } catch (err) {
    return toSendResult(err);
  }
}

async function sendPhoto(db: FieldkitDb, record: OutboxRecord): Promise<SendResult> {
  const { visit_id, photo_id } = record.payload as UploadPhotoPayload;
  const blob = await getPhoto(db, photo_id);
  if (!blob) return { ok: false, retry: false, reason: 'photo_missing_on_device' };
  try {
    await uploadPhoto(visit_id, blob, `${photo_id}.jpg`, record.idempotencyKey);
    const now = new Date().toISOString();
    await db.transaction('rw', db.photos, db.visits, async () => {
      await db.photos.update(photo_id, { uploaded_at: now });
      const v = await db.visits.get(visit_id);
      if (v) await db.visits.update(visit_id, { photo_count: v.photo_count + 1 });
    });
    return { ok: true };
  } catch (err) {
    // The visit itself has not landed yet (its create is still retrying).
    // Keep the photo in the queue; it will go once the visit exists.
    if (err instanceof ApiError && err.reason === REASON.notFound) {
      return { ok: false, retry: true, reason: 'visit_not_synced' };
    }
    return toSendResult(err);
  }
}
