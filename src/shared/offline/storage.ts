// Quota, eviction and the two calls that matter.
//
// Storage is best-effort by default: under pressure the browser deletes an
// origin's data without asking. persist() asks to be exempt and may say no;
// estimate() says how close to the ceiling we are.

export interface StorageStatus {
  usage: number;
  quota: number;
  /** usage / quota, 0..1. */
  ratio: number;
  /** Result of persist(), or null when the API is missing. */
  persisted: boolean | null;
}

/** Threshold at which the app stops accepting new photos (forms still save). */
export const PHOTO_STOP_RATIO = 0.8;

export async function requestPersistence(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0, ratio: 0, persisted: null };
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  let persisted: boolean | null = null;
  try {
    persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  } catch {
    persisted = null;
  }
  return { usage, quota, ratio: quota > 0 ? usage / quota : 0, persisted };
}

/** The device signals we can read, each defaulting to the conservative branch. */
export interface DeviceHints {
  cores: number;
  /** GB, power of two, Chromium only; undefined elsewhere. */
  memoryGb: number | undefined;
  saveData: boolean;
}

export function deviceHints(): DeviceHints {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  });
  return {
    cores: nav?.hardwareConcurrency ?? 2,
    memoryGb: nav?.deviceMemory,
    saveData: nav?.connection?.saveData === true,
  };
}

/**
 * Photo byte budget. Hints are Chromium-only, so an undefined value must
 * land on the conservative branch by design, not by luck.
 */
export function photoBudgetBytes(hints: DeviceHints = deviceHints()): number {
  const lowEnd = hints.saveData || hints.memoryGb === undefined || hints.memoryGb <= 2;
  return lowEnd ? 600_000 : 1_500_000;
}
