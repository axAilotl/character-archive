# Character Archive Docker Build
# Build context should be the parent directory containing both:
#   - character-archive/  (this project)
#   - character-foundry/  (monorepo with workspace packages)
#
# Build command:
#   docker build -f character-archive/Dockerfile -t character-archive .

# =============================================================================
# Stage 1: Build workspace packages from monorepo
# =============================================================================
FROM node:20-alpine AS packages
WORKDIR /build

# Install pnpm
RUN corepack enable pnpm

# Copy only the packages we need from the monorepo
COPY character-foundry/packages/core ./packages/core
COPY character-foundry/packages/schemas ./packages/schemas
COPY character-foundry/packages/image-utils ./packages/image-utils
COPY character-foundry/packages/charx ./packages/charx

# Build core (dependency of other packages)
WORKDIR /build/packages/core
RUN pnpm install && pnpm run build 2>/dev/null || true

# Build schemas
WORKDIR /build/packages/schemas
RUN pnpm install && pnpm run build 2>/dev/null || true

# Build image-utils
WORKDIR /build/packages/image-utils
RUN pnpm install && pnpm run build 2>/dev/null || true

# Build charx (fix its workspace references first)
WORKDIR /build/packages/charx
RUN sed -i 's|"workspace:\^"|"file:../core"|' package.json && \
    sed -i 's|"@character-foundry/schemas": "file:../core"|"@character-foundry/schemas": "file:../schemas"|' package.json && \
    pnpm install && pnpm run build 2>/dev/null || true

# =============================================================================
# Stage 2: Install backend dependencies
# =============================================================================
FROM node:20-alpine AS backend-deps
WORKDIR /app

# Install pnpm and build tools for native modules (better-sqlite3)
# py3-setuptools provides distutils for Python 3.12+
RUN corepack enable pnpm && \
    apk add --no-cache python3 py3-setuptools make g++

# Copy built packages from stage 1
COPY --from=packages /build/packages /packages

# Copy package files
COPY character-archive/package.json character-archive/pnpm-lock.yaml ./

# Convert workspace:^ references to file: references for Docker build
# This allows pnpm to find the local packages without workspace config
RUN sed -i 's|"@character-foundry/image-utils": "workspace:\^"|"@character-foundry/image-utils": "file:/packages/image-utils"|' package.json && \
    sed -i 's|"@character-foundry/schemas": "workspace:\^"|"@character-foundry/schemas": "file:/packages/schemas"|' package.json

# Add charx as a direct dependency (used by RisuAiScraper but missing from package.json)
RUN node -e "const p=require('./package.json'); p.dependencies['@character-foundry/charx']='file:/packages/charx'; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# Fix workspace references in charx package
RUN sed -i 's|"workspace:\^"|"file:/packages/core"|' /packages/charx/package.json && \
    sed -i 's|"@character-foundry/schemas": "file:/packages/core"|"@character-foundry/schemas": "file:/packages/schemas"|' /packages/charx/package.json

# Verify the substitution worked
RUN cat package.json | grep -E "@character-foundry/(schemas|image-utils|charx)"

# Install dependencies without workspace (uses file: references)
RUN pnpm install --no-frozen-lockfile

# Force rebuild native modules (pnpm 10.x skips build scripts by default)
# Use npm rebuild which respects native module build scripts
RUN cd node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3 && npm run build-release

# =============================================================================
# Stage 3: Build Next.js frontend
# =============================================================================
FROM node:20-alpine AS frontend
WORKDIR /app/frontend

# Copy frontend package files (frontend uses npm, not pnpm)
COPY character-archive/frontend/package.json character-archive/frontend/package-lock.json ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source
COPY character-archive/frontend/ ./

# Build Next.js for production
ENV NODE_ENV=production
RUN npm run build

# =============================================================================
# Stage 4: Production runtime
# =============================================================================
FROM node:20-alpine AS runtime
WORKDIR /app

# Install runtime dependencies
# - sqlite: for better-sqlite3 runtime
# - wget: for healthchecks
RUN apk add --no-cache sqlite wget

# Copy workspace packages (needed at runtime)
COPY --from=packages /build/packages /packages

# Copy backend with installed dependencies
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-deps /app/package.json ./

# Copy backend source
COPY character-archive/server.js character-archive/config.js ./
COPY character-archive/backend ./backend
COPY character-archive/scripts ./scripts

# Copy built frontend
COPY --from=frontend /app/frontend/.next ./frontend/.next
COPY --from=frontend /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend /app/frontend/package.json ./frontend/

# Copy frontend public assets from source (not from build stage)
COPY character-archive/frontend/public ./frontend/public

# Create directories for persistent data (will be mounted as volumes)
RUN mkdir -p /app/static /app/data

# Copy and set up entrypoint
COPY character-archive/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose ports
# 6969: Backend API
# 3177: Frontend UI
EXPOSE 6969 3177

# Environment defaults
ENV NODE_ENV=production
ENV PORT=6969
ENV HOST=0.0.0.0
ENV LOG_LEVEL=INFO

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -q --spider http://localhost:6969/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
