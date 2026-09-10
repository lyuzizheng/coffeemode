# Image Service

Cloudflare Worker that signs presigned R2 URLs for the CoffeeMode image pipeline.

## What it does

- `POST /v1/images/upload` — returns a short-lived presigned R2 PUT URL for the browser to upload `original/{uuid}.webp`.
- `POST /v1/images/complete` — verifies the uploaded original exists and returns presigned GET/PUT URLs so the Next.js server (running `sharp` on the VPS) can download the original and write `card/{uuid}.webp` and `thumbnail/{uuid}.webp`.

The Worker is the only component with R2 S3 signing credentials. Next.js receives presigned URLs only; the browser sees the presigned upload URL but never the credentials.

## Local development

```bash
npm install
# Add R2_ACCOUNT_ID under [vars] in wrangler.toml
# Create .dev.vars (gitignored) with:
#   IMAGE_SERVICE_TOKEN=...
#   R2_ACCESS_KEY_ID=...
#   R2_SECRET_ACCESS_KEY=...
npm run dev
```

## Tests

```bash
npm run typecheck
npm test
```

## Deploy

```bash
# Secrets are per-environment; repeat with --env production once staging is verified.
wrangler secret put IMAGE_SERVICE_TOKEN --env staging
wrangler secret put R2_ACCESS_KEY_ID --env staging
wrangler secret put R2_SECRET_ACCESS_KEY --env staging

npm run deploy -- --env staging        # → scripts/deploy.mjs → wrangler deploy --env staging
npm run deploy -- --env production
```

`--env` is required and the deploy is guarded by `scripts/deploy.mjs`: it resolves
`wrangler.toml` for that environment and refuses to deploy when the resolved
`[vars]`/`r2_buckets` still point at local dev (`R2_ACCOUNT_ID = "local"`, a
localhost `R2_ENDPOINT`/`R2_PUBLIC_URL`, the `coffeemode` local bucket) or when
the environment has no `[env.<name>]` block — the two ways a bare
`wrangler deploy` silently bakes MinIO-on-localhost into the Worker, which breaks
every presigned upload and HEAD check at runtime.

Validate without deploying:

```bash
npm run deploy:check                   # both environments, --check mode
npm run deploy -- --env production --dry-run
```

See `docs/agent/pending-user-actions.md` §6 for the full owner-only setup checklist.
