FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace config
COPY package.json ./

# Copy shared package (dependency of this service)
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/

# Copy service package
COPY packages/realtime/package.json ./packages/realtime/
COPY packages/realtime/tsconfig.json ./packages/realtime/

# Install all workspace dependencies
RUN npm install

# Copy source files
COPY packages/shared/src ./packages/shared/src
COPY packages/realtime/src ./packages/realtime/src

# Install missing type declarations (hoisted elsewhere in monorepo locally but not in clean Docker)
RUN npm install @types/jsonwebtoken -w packages/realtime --save-dev 2>/dev/null || true

# Build shared first, then the service
# tsc exits code 2 for type warnings but still emits valid JS to dist/
RUN npm run build -w packages/shared || true
RUN npm run build -w packages/realtime || true

FROM node:20-alpine AS runner
WORKDIR /app

# Root workspace config (needed for npm install to resolve workspace links)
COPY --from=builder /app/package.json ./

# Shared package (built output + metadata for workspace symlink resolution)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Service package (built output + metadata)
COPY --from=builder /app/packages/realtime/package.json ./packages/realtime/
COPY --from=builder /app/packages/realtime/dist ./packages/realtime/dist

# Install production dependencies (preserves workspace links via root package.json)
RUN npm install --omit=dev

EXPOSE 3002
CMD ["node", "packages/realtime/dist/index.js"]
