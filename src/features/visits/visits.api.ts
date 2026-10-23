// Server calls for visits. Wire shapes copied from the backend.
import { get, getPage, post, put, upload } from '@shared/api/client';
import type { PageMeta } from '@shared/api/types';
import { EP } from '@shared/constants/endpoints';

export interface Visit {
  id: string;
  agent_id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  version: number;
  photo_count: number;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateVisitRequest {
  id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  captured_at: string;
}

export interface UpdateVisitRequest {
  base_version: number;
  shop_name?: string;
  owner_name?: string;
  phone?: string;
  lat?: number | null;
  lng?: number | null;
}

export interface Photo {
  id: string;
  visit_id: string;
  bytes: number;
  content_hash: string;
  content_type: string;
  created_at: string;
}

export interface Stats {
  total: number;
  received_today: number;
  photos: number;
  by_agent: { agent_id: string; name: string; count: number }[];
}

export function listVisits(cursor?: string, limit = 50): Promise<{ data: Visit[]; meta: PageMeta; fromCache: boolean }> {
  return getPage<Visit[]>(EP.visits, { searchParams: { limit, ...(cursor && { cursor }) } });
}

export function getVisit(id: string): Promise<Visit> {
  return get<Visit>(EP.visit(id));
}

export function createVisit(body: CreateVisitRequest, idempotencyKey: string): Promise<Visit> {
  return post<Visit>(EP.visits, body, idempotencyKey);
}

export function updateVisit(id: string, body: UpdateVisitRequest, idempotencyKey: string): Promise<Visit> {
  return put<Visit>(EP.visit(id), body, idempotencyKey);
}

export function uploadPhoto(visitId: string, file: Blob, filename: string, idempotencyKey: string): Promise<Photo> {
  return upload<Photo>(EP.visitPhotos(visitId), file, filename, idempotencyKey);
}

export function getStats(): Promise<Stats> {
  return get<Stats>(EP.stats);
}
