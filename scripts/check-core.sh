#!/usr/bin/env bash
# The offline core (src/shared/offline, src/sw.ts, src/shared/api/client.ts)
# is copied verbatim between the fieldkit and wallet frontends. CORE_CHECKSUM
# pins the published copy; a change here must be made in both repos and the
# checksum updated in both, in the same change.
set -euo pipefail
cd "$(dirname "$0")/.."
actual=$( (find src/shared/offline -type f ! -path '*/__tests__/*' -print0; printf 'src/sw.ts\0src/shared/api/client.ts\0') | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
if [ "${1:-}" = "--write" ]; then
  echo "$actual" > CORE_CHECKSUM
  echo "CORE_CHECKSUM updated: $actual"
  exit 0
fi
expected=$(cat CORE_CHECKSUM)
if [ "$actual" != "$expected" ]; then
  echo "offline core differs from the published copy (expected $expected, got $actual)" >&2
  echo "run scripts/check-core.sh --write in BOTH frontends after syncing the copy" >&2
  exit 1
fi
echo "offline core matches CORE_CHECKSUM"
