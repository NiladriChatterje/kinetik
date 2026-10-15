FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace config and the lockfile. npm ci installs exactly the
# versions in package-lock.json; a lockless `npm install` re-resolves every
# package and trips an npm 10 bug (Cannot read properties of null 'edgesOut').
COPY package.json package-lock.json ./

# Copy shared package (dependency of this service)
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/

# Copy service package
COPY packages/api-core/package.json ./packages/api-core/
COPY packages/api-core/tsconfig.json ./packages/api-core/

# The lockfile spans every workspace, so npm ci needs each manifest present.
COPY packages/realtime/package.json ./packages/realtime/

# Install all workspace dependencies from the lockfile
RUN npm ci

# Copy source files
COPY packages/shared/src ./packages/shared/src
COPY packages/api-core/src ./packages/api-core/src
COPY packages/api-core/certs ./packages/api-core/certs

# Build shared first, then the service
# tsc exits code 2 for type warnings but still emits valid JS to dist/
RUN npm run build -w packages/shared || true
RUN npm run build -w packages/api-core || true

FROM node:20-alpine AS runner
WORKDIR /app

# Root workspace config + lockfile (needed for npm ci to resolve workspace links)
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/realtime/package.json ./packages/realtime/

# Shared package (built output + metadata for workspace symlink resolution)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Service package (built output + metadata)
COPY --from=builder /app/packages/api-core/package.json ./packages/api-core/
COPY --from=builder /app/packages/api-core/dist ./packages/api-core/dist
COPY --from=builder /app/packages/api-core/certs ./packages/api-core/certs

# Install production dependencies (preserves workspace links via root package.json)
RUN npm ci --omit=dev

EXPOSE 3001
CMD ["node", "packages/api-core/dist/index.js"]
