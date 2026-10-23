// The signed-in agent. Held in memory for the request hook and mirrored to
// IndexedDB so a reload while offline still has a session. No global store:
// this is one module with a subscribe function, read through useSession().
import { useSyncExternalStore } from 'react';

import type { OfflineDb } from '@shared/offline';

export interface Agent {
  id: string;
  name: string;
  phone: string;
}

export interface Session {
  token: string;
  agent: Agent;
}

const KV_KEY = 'session';

let current: Session | null = null;
let loaded = false;
let db: OfflineDb | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Restores the session from IndexedDB once at start. */
export async function loadSession(database: OfflineDb): Promise<Session | null> {
  db = database;
  current = await database.getKv<Session | null>(KV_KEY, null);
  loaded = true;
  emit();
  return current;
}

export async function saveSession(session: Session): Promise<void> {
  current = session;
  emit();
  await db?.setKv(KV_KEY, session);
}

export async function clearSession(): Promise<void> {
  current = null;
  emit();
  await db?.kv.delete(KV_KEY);
}

/** Synchronous read for the HTTP hook. */
export function readToken(): string | null {
  return current?.token ?? null;
}

export function readSession(): Session | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface SessionState {
  session: Session | null;
  /** False until the IndexedDB read has finished. */
  ready: boolean;
}

let snapshot: SessionState = { session: null, ready: false };
function getSnapshot(): SessionState {
  if (snapshot.session !== current || snapshot.ready !== loaded) snapshot = { session: current, ready: loaded };
  return snapshot;
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test helper: forget everything without touching the database. */
export function resetSessionForTests(): void {
  current = null;
  loaded = false;
  db = null;
  emit();
}
