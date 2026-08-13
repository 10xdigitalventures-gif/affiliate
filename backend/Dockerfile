# ─── Build stage ───────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate
RUN npm run build

# ─── Production stage ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

USER nestjs
EXPOSE 4000

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
