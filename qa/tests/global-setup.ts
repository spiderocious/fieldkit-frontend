// Runs once before the suite: puts the fieldkit database back to its seeded
// state so the recording always starts from the same twenty visits. The
// wallet suite creates a fresh user per run and needs no reset.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PSQL = process.env.PSQL ?? 'psql';
const FIELDKIT_DB = process.env.FIELDKIT_DATABASE_URL ?? 'postgres://fieldkit:fieldkit@localhost:5432/fieldkit?sslmode=disable';
const BACKEND = path.resolve(import.meta.dirname, '..', '..', 'fieldkit', 'backend');

export default function globalSetup(): void {
  // Against a deployment there is nothing local to reset; shop names carry a run stamp.
  if (process.env.FIELDKIT_WEB) return;
  execFileSync(PSQL, [FIELDKIT_DB, '-v', 'ON_ERROR_STOP=1', '-c', 'TRUNCATE photos, visits, idempotency_keys, telemetry_events'], { stdio: 'inherit' });
  execFileSync('go', ['run', './cmd/seed'], { cwd: BACKEND, stdio: 'inherit', env: { ...process.env, DATABASE_URL: FIELDKIT_DB } });
}
