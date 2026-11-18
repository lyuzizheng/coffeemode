# CafeMood web — standalone deploy (ADR-0001: VPS + Docker)
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
ARG NEXT_PUBLIC_R2_PUBLIC_URL
ENV NEXT_PUBLIC_R2_PUBLIC_URL=${NEXT_PUBLIC_R2_PUBLIC_URL}
# Turnstile sitekey is public-by-design but inlined into the client bundle at
# build time (BRAWUKA-564): without this ARG the widget can never mint tokens.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
ARG APP_ENV
ENV APP_ENV=${APP_ENV}
# Fail closed on a missing deploy environment (BRAWUKA-981). `next.config.ts`
# serializes the CSP at build time from `APP_ENV`, and this image is the only
# build served behind the Cloudflare zone, which injects the Web Analytics
# beacon into every hostname. Without the arg the image bakes the closed
# policy, every staging and production page load logs a `script-src`
# violation, and `resolveR2PublicHost` falls back to the production CDN. The
# deploy build arg lives in Dokploy's application config, not in this repo,
# so the image itself must refuse to build without it.
RUN case "${APP_ENV}" in \
      production|staging) ;; \
      *) echo "FATAL: APP_ENV must be 'production' or 'staging' at build time, got '${APP_ENV:-<unset>}'. Set it as a build arg on the Dokploy application (deploy/dokploy/README.md)." >&2; exit 1 ;; \
    esac
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ARG APP_VERSION
ENV APP_VERSION=${APP_VERSION}
ARG APP_ENV
ENV APP_ENV=${APP_ENV}

# Next.js standalone needs the static assets and BUILD_ID copied in by hand.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/.next/BUILD_ID ./.next/BUILD_ID
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
# Migration inputs + gate (BRAWUKA-690): migrate.mjs resolves MIGRATIONS_DIR
# as <script>/../db/migrations, so db/ must ship with the image and the
# entrypoint must run it before the server, or every deploy re-creates
# schema drift (ledger trails repo -> 42703 on new columns).
COPY --from=build /app/db ./db
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=deps /app/node_modules/yaml ./node_modules/yaml
EXPOSE 3000
# Fail-closed order: migrations must succeed before server.js starts.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
