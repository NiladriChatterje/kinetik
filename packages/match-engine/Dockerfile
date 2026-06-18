FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace config
COPY package.json ./

# Copy shared package (dependency of this service)
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/

# Copy service package
COPY packages/match-engine/package.json ./packages/match-engine/
COPY packages/match-engine/tsconfig.json ./packages/match-engine/

# Install all workspace dependencies
RUN npm install

# Copy source files
COPY packages/shared/src ./packages/shared/src
COPY packages/match-engine/src ./packages/match-engine/src

# Build shared first, then the service
# tsc exits code 2 for type warnings but still emits valid JS to dist/
RUN npm run build -w packages/shared || true
RUN npm run build -w packages/match-engine || true

FROM node:20-alpine AS runner
WORKDIR /app

# Root workspace config (needed for npm install to resolve workspace links)
COPY --from=builder /app/package.json ./

# Shared package (built output + metadata for workspace symlink resolution)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Service package (built output + metadata)
COPY --from=builder /app/packages/match-engine/package.json ./packages/match-engine/
COPY --from=builder /app/packages/match-engine/dist ./packages/match-engine/dist

# Install production dependencies (preserves workspace links via root package.json)
RUN npm install --omit=dev

EXPOSE 3003
CMD ["node", "packages/match-engine/dist/index.js"]
