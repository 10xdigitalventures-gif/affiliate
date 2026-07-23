FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build \
  && test -f dist/main.js \
  && test -f dist/app.module.js \
  && test -f dist/auth/auth.module.js

# Tooling image is short-lived and used only for migrations/admin bootstrap.
FROM build AS tools

FROM build AS production-deps
RUN npm prune --omit=dev --no-audit --no-fund

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nestjs
COPY --from=production-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json
USER nestjs
EXPOSE 4100
CMD ["node", "dist/main.js"]
