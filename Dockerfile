# TeamFlow — one container: the API also serves the built React app on the same address.
# Build:  docker build -t teamflow .
# Run:    docker run --env-file backend/.env.production -p 4000:4000 teamflow
# Configuration comes only from environment variables at run time; no secrets are baked into the image.

# ── 1. Frontend build ───────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Same-origin API: the default /api/v1 is correct when the backend serves the frontend.
RUN npm run build

# ── 2. Backend (production dependencies only) ───────────────────────
FROM node:22-slim AS runtime
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    SERVE_FRONTEND=true \
    PORT=4000
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
# postinstall runs "prisma generate" for this platform.
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY --from=frontend /app/frontend/dist /app/frontend/dist

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Pending migrations first (direct connection when DIRECT_URL is set), then the server.
CMD ["sh", "-c", "node scripts/migrate-deploy.js && node src/server.js"]
