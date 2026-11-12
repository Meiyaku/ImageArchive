#!/usr/bin/env bash
# Runs ON the k3s node, called by deploy.sh over `ssh -t`. Applies the manifests,
# creating the imagearchive-secrets Secret on the first deploy.
#
# Secrets are passed to kubectl on stdin, never as command-line arguments (which any
# user on the node could see with `ps`). The first-admin password is only needed until
# the app has created that account, so it's removed from the Secret after a successful
# rollout.
set -euo pipefail

DIR="$1"
NS=imagearchive
K="sudo k3s kubectl"
# The build context lives in /tmp; remove it however this script ends.
trap 'rm -rf "$DIR"' EXIT

$K apply -f "$DIR/k8s/namespace.yaml"

if ! $K -n "$NS" get secret imagearchive-secrets >/dev/null 2>&1; then
  echo "First deploy: set up the first admin account."
  read -r -p "Admin username [admin]: " admin_user
  admin_user="${admin_user:-admin}"
  while :; do
    read -r -s -p "Admin password (min 8 characters): " admin_pass
    echo
    [ "${#admin_pass}" -ge 8 ] && break
    echo "Too short, try again."
  done
  db_pass="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  # printf is a shell builtin, so the values never become process arguments.
  printf 'POSTGRES_PASSWORD=%s\nADMIN_USERNAME=%s\nADMIN_PASSWORD=%s\n' "$db_pass" "$admin_user" "$admin_pass" \
    | $K -n "$NS" create secret generic imagearchive-secrets --from-env-file=/dev/stdin
  unset admin_pass db_pass
fi

$K apply -k "$DIR/k8s"
$K -n "$NS" rollout status statefulset/postgres --timeout=180s
$K -n "$NS" rollout status deployment/imagearchive --timeout=180s

# The app creates the first admin before it reports ready (and exits if it can't), so a
# successful rollout means the password has done its job.
if [ -n "$($K -n "$NS" get secret imagearchive-secrets -o jsonpath='{.data.ADMIN_PASSWORD}')" ]; then
  $K -n "$NS" patch secret imagearchive-secrets --type=json \
    -p='[{"op":"remove","path":"/data/ADMIN_PASSWORD"}]'
  echo "Removed the first-admin password from the cluster secret."
fi
