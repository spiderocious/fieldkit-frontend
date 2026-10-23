// The three intents the visits feature writes to the outbox. Payloads are
// the wire bodies, so the sender has no translation to do.
import type { CreateVisitRequest, UpdateVisitRequest } from './visits.api';

export const INTENT = {
  createVisit: 'visit.create',
  updateVisit: 'visit.update',
  uploadPhoto: 'photo.upload',
} as const;

export type CreateVisitPayload = CreateVisitRequest;

export interface UpdateVisitPayload {
  visit_id: string;
  fields: Omit<UpdateVisitRequest, 'base_version'>;
}

export interface UploadPhotoPayload {
  visit_id: string;
  photo_id: string;
}

/** Outbox ids are deterministic so an intent can be found by what it is about. */
export const intentId = {
  create: (visitId: string) => visitId,
  update: (visitId: string) => `${visitId}:update`,
  photo: (photoId: string) => photoId,
};
