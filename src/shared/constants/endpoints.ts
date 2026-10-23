// Every API path, relative to the versioned base. The client prefixes
// `${API_BASE}` so callers never build URLs by hand.
export const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

export const EP = {
  ping: 'ping',
  login: 'auth/login',
  me: 'auth/me',
  visits: 'visits',
  visit: (id: string) => `visits/${id}`,
  visitPhotos: (id: string) => `visits/${id}/photos`,
  visitPhoto: (id: string, photoId: string) => `visits/${id}/photos/${photoId}`,
  stats: 'visits/stats',
  telemetry: 'telemetry',
} as const;

/** The probe the sync engine uses to decide "online". Absolute, bypasses the SW. */
export const PROBE_URL = `${API_BASE}/${EP.ping}`;
