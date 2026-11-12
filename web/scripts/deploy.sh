#!/usr/bin/env bash
# Copy the source to the k3s node, build the image there with its Docker, push it
# to the registry on the node (localhost:5000), then apply the manifests with the
# image tag set to the git SHA. Only SSH access is needed locally.
#
# First deploy: creates the imagearchive-secrets Secret (random DB password, and
# the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD, prompted if unset).
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-k3s.snowborn.com}"
DEPLOY_USER="${DEPLOY_USER:-sb}"
NAMESPACE="imagearchive"
REPO="localhost:5000/imagearchive"
REMOTE_DIR="/tmp/imagearchive-deploy"

target="$DEPLOY_USER@$DEPLOY_HOST"
cd "$(dirname "$0")/.."

# Tag with the commit; uncommitted changes get a timestamp so the node never
# reuses a stale image cached under the same tag.
if git rev-parse --short HEAD >/dev/null 2>&1; then
  TAG="$(git rev-parse --short HEAD)"
  if [ -n "$(git status --porcelain -- .)" ]; then TAG="$TAG-dirty-$(date +%Y%m%d%H%M%S)"; fi
else
  TAG="dev-$(date +%Y%m%d%H%M%S)"
fi
IMAGE="$REPO:$TAG"

echo "==> Copying build context and manifests to $target"
ssh "$target" "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --no-fflags -czf - \
  Dockerfile .dockerignore package.json package-lock.json index.html vite.config.ts \
  tsconfig.json tsconfig.app.json tsconfig.server.json src server public k8s \
  | ssh "$target" "tar -xzf - -C $REMOTE_DIR"

echo "==> Building and pushing $IMAGE on $DEPLOY_HOST"
ssh "$target" "
  set -e
  docker build -t $IMAGE -t $REPO:latest $REMOTE_DIR
  docker push $IMAGE
  docker push $REPO:latest
  printf 'images:\\n  - name: %s\\n    newTag: %s\\n' $REPO $TAG >> $REMOTE_DIR/k8s/kustomization.yaml
"

# Only needed (and only used) on the first deploy, but we don't know that until
# we're on the node, so collect it up front if not provided.
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "If this is the first deploy, an admin account \"$ADMIN_USERNAME\" will be created."
  read -r -s -p "Admin password (min 8 chars; ignored if already deployed): " ADMIN_PASSWORD
  echo
fi
DB_PASSWORD="$(openssl rand -hex 24)"

echo "==> Applying manifests (sudo on $DEPLOY_HOST)"
ssh -t "$target" "
  set -e
  K='sudo k3s kubectl'
  \$K apply -f $REMOTE_DIR/k8s/namespace.yaml
  if ! \$K -n $NAMESPACE get secret imagearchive-secrets >/dev/null 2>&1; then
    echo 'Creating imagearchive-secrets'
    \$K -n $NAMESPACE create secret generic imagearchive-secrets \
      --from-literal=POSTGRES_PASSWORD='$DB_PASSWORD' \
      --from-literal=ADMIN_USERNAME='$ADMIN_USERNAME' \
      --from-literal=ADMIN_PASSWORD='$(printf %s "$ADMIN_PASSWORD" | sed "s/'/'\\\\''/g")'
  fi
  \$K apply -k $REMOTE_DIR/k8s
  \$K -n $NAMESPACE rollout status statefulset/postgres --timeout=180s
  \$K -n $NAMESPACE rollout status deployment/imagearchive --timeout=180s
  rm -rf $REMOTE_DIR
"

echo "==> Deployed: http://imagearchive.snowborn.com"
