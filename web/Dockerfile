# CoffeeMode web — standalone deploy (ADR-0001: VPS + Docker)
#
# With `output: "standalone"` Next.js emits a minimal server under
# .next/standalone, but it does NOT include static assets. Copying
# .next/static and public/ in is mandatory (verified 2026-08-09: without
# them every JS/CSS chunk 404s and every page renders blank).
# See https://nextjs.org/docs/app/guides/self-hosting (standalone mode).

FROM node:22-alpine AS base
WORKDIR /app

# ---- deps ---------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# CI builds run without credentials; the app throws at request time, not
# import time, when env is missing.
ENV NEXT_TELEMETRY_DISABLED=1
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}

# Next.js standalone needs the static assets and BUILD_ID copied in by hand.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/.next/BUILD_ID ./.next/BUILD_ID
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
