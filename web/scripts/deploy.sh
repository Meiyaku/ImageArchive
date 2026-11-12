#!/usr/bin/env bash
# Copy the source to the k3s node, build the image there with its Docker, push it
# to the registry on the node (localhost:5000), then apply the manifests with the
# image tag set to the git SHA. Only SSH access is needed locally.
#
# First deploy: scripts/remote-apply.sh (run on the node) creates the
# imagearchive-secrets Secret with a random DB password and prompts for the first
# admin account.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-k3s.snowborn.com}"
DEPLOY_USER="${DEPLOY_USER:-sb}"
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
  scripts/remote-apply.sh \
  | ssh "$target" "tar -xzf - -C $REMOTE_DIR"

echo "==> Building and pushing $IMAGE on $DEPLOY_HOST"
ssh "$target" "
  set -e
  docker build -t $IMAGE -t $REPO:latest $REMOTE_DIR
  docker push $IMAGE
  docker push $REPO:latest
  printf 'images:\\n  - name: %s\\n    newTag: %s\\n' $REPO $TAG >> $REMOTE_DIR/k8s/kustomization.yaml
"

echo "==> Applying manifests on $DEPLOY_HOST (asks for your sudo password there)"
# Interactive (-t): sudo, and on the first deploy the admin-account prompts, run on the node.
ssh -t "$target" "bash $REMOTE_DIR/scripts/remote-apply.sh $REMOTE_DIR"

echo "==> Deployed: http://imagearchive.snowborn.com"
