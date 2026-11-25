# Base images are pinned by digest so a build is reproducible and a changed upstream
# image can't slip in unnoticed. To take upstream security fixes, bump the digests
# (see "Updating pinned images" in CLAUDE.md).
# ---- build stage: compile the React client ---------------------------------
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: Express API + static client ---------------------------------
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/dist \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json package-lock.json ./
# Production deps only; sharp pulls its linux-musl binary for this arch here.
RUN npm ci --omit=dev && npm cache clean --force
# The server runs as TypeScript directly via Node's built-in type stripping.
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/index.ts"]
