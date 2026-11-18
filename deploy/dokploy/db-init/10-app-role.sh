#!/usr/bin/env bash
# ==============================================================================
# Dokploy Postgres — first-initialization application role (ADR-0010)
#
# Runs once, from /docker-entrypoint-initdb.d, after initdb and before the
# server accepts external connections. Creates the login role the Next.js app
# uses:
#   - LOGIN, explicitly NOT SUPERUSER and NOT CREATEDB
#   - owns schema public, so migrations can create tables and indexes
#   - restores and drills never use this role: they run as the recovery role
#     (STAGING_RESTORE_URL / PROD_RESTORE_URL, ADR-0010 §3), because only a
#     superuser can drop and recreate the PostGIS extension
#
# PostGIS is created here by the superuser so the migration's
# `create extension if not exists postgis` is a no-op rather than a privileged
# operation for the application role.
#
# Required env (see deploy/dokploy/.env.<env>.example):
#   POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD — superuser + database
#   APP_DB_PASSWORD — application role password; must match DATABASE_URL and
#                     DIRECT_URL
# ==============================================================================
set -euo pipefail

: "${POSTGRES_DB:=coffeemode}"
: "${POSTGRES_USER:=postgres}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set and must match the password in DATABASE_URL/DIRECT_URL}"

app_user="coffeemode"

echo "[db-init] creating application role '${app_user}' in '${POSTGRES_DB}'"
psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  -v app_user="${app_user}" \
  -v app_password="${APP_DB_PASSWORD}" \
  -v dbname="${POSTGRES_DB}" <<'SQL'
SELECT format(
         'CREATE ROLE %I LOGIN PASSWORD %L',
         :'app_user',
         :'app_password'
       )
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')\gexec

GRANT ALL PRIVILEGES ON DATABASE :"dbname" TO :"app_user";
ALTER SCHEMA public OWNER TO :"app_user";
SQL

echo "[db-init] creating PostGIS extension as superuser"
psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  -c 'CREATE EXTENSION IF NOT EXISTS postgis;'

echo "[db-init] application role ready"
