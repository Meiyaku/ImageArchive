#!/usr/bin/env bash
# Prove the NAS backup restores, without touching production: start a throwaway pod
# that pulls the newest dump and the photos from the NAS, load the dump into its own
# scratch Postgres, compare tables and photos with production, then delete the pod.
# Needs kubectl on the node for $DEPLOY_USER (no sudo). Run from web/.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-k3s.snowborn.com}"
DEPLOY_USER="${DEPLOY_USER:-sb}"
target="$DEPLOY_USER@$DEPLOY_HOST"
cd "$(dirname "$0")"

cleanup() { ssh "$target" 'kubectl -n imagearchive delete pod restore-test --ignore-not-found --wait=false' >/dev/null || true; }
trap cleanup EXIT

# Back up first, so production still matches the backup when compared (sign-ins and
# uploads change it). A sign-in during the test can still make the tables differ: rerun.
echo "==> Running a backup now"
ssh "$target" 'K="kubectl -n imagearchive"; job="restore-test-backup-$(date -u +%H%M%S)"
  $K create job --from=cronjob/imagearchive-backup "$job" >/dev/null
  $K wait --for=condition=complete --timeout=600s "job/$job" >/dev/null || { $K logs "job/$job" --all-containers; exit 1; }
  $K logs "job/$job" -c copy-to-nas | grep -v NOTICE
  $K delete job "$job" >/dev/null'

echo "==> Fetching the newest backup from the NAS into a scratch pod"
ssh "$target" 'kubectl -n imagearchive delete pod restore-test --ignore-not-found --wait=true >/dev/null
  kubectl apply -f - >/dev/null
  kubectl -n imagearchive wait --for=condition=ready --timeout=600s pod/restore-test >/dev/null
  kubectl -n imagearchive logs restore-test -c fetch-from-nas | grep -v NOTICE' < pod.yaml

echo "==> Loading the dump into the scratch database"
ssh "$target" 'R="kubectl -n imagearchive exec -i restore-test -c db --"
  i=0
  until $R pg_isready -q -U imagearchive 2>/dev/null; do
    i=$((i + 1)); [ "$i" -lt 60 ] || { echo "Scratch Postgres did not start" >&2; exit 1; }
    sleep 2
  done
  $R sh -c "gunzip -c /restore/dump.sql.gz | psql -q -v ON_ERROR_STOP=1 -U imagearchive -d imagearchive" >/dev/null'

echo "==> Comparing with production"
out="$(ssh "$target" 'sh -s' < compare.sh)"
echo "$out"
grep -q 'TABLES MATCH' <<<"$out" && grep -q 'PHOTOS MATCH' <<<"$out" && ! grep -q '^MISSING' <<<"$out" \
  || { echo "RESTORE TEST FAILED" >&2; exit 1; }
echo "==> Restore test passed"
