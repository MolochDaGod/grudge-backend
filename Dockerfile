# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY tsconfig.json drizzle.config.ts ./
COPY server ./server
COPY shared ./shared

RUN npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# ── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm install drizzle-kit

COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY drizzle.config.ts ./

EXPOSE 5000

# Run DB migration then start server
CMD ["sh", "-c", "npx drizzle-kit push --config=drizzle.config.ts && node dist/index.js"]
