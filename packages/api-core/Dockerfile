FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY ../../packages/shared ../shared
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package.json ./
RUN npm ci --production
EXPOSE 3001
CMD ["node", "dist/index.js"]
