/**
 * R2 object primitives for the image-service maintenance scripts
 * (BRAWUKA-730): the orphan sweeper lists two prefixes and deletes through the
 * S3 API, so the client, key encoding, HEAD and list paging live here instead
 * of growing the CLI entry past the spec 0009 file budget.
 *
 * Credentials are read from the environment at import time — every caller is a
 * one-shot CLI (VPS cron / GitHub schedule via #154) started with R2_* set.
 */

import { AwsClient } from "aws4fetch";

export const r2Env = {
  endpoint: process.env.R2_ENDPOINT?.replace(/\/+$/, "") ?? "",
  accountId: process.env.R2_ACCOUNT_ID ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  bucketName: process.env.R2_BUCKET_NAME ?? "",
};

export function baseEndpoint() {
  if (r2Env.endpoint) return r2Env.endpoint;
  return `https://${r2Env.accountId}.r2.cloudflarestorage.com`;
}

let cachedClient = null;
export function client() {
  cachedClient ??= new AwsClient({
    accessKeyId: r2Env.accessKeyId,
    secretAccessKey: r2Env.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  return cachedClient;
}

/**
 * Encode a key into an S3 REST path (BRAWUKA-592): a raw `&` or `%` would
 * split the path or address the wrong object.
 */
export function objectUrl(key) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${baseEndpoint()}/${r2Env.bucketName}/${encoded}`;
}

/**
 * HEAD one object and hand back the response — callers own the decision, and
 * never delete on uncertain state.
 */
export async function headObject(key) {
  return client().fetch(objectUrl(key), { method: "HEAD", redirect: "manual" });
}

/**
 * Delete one object; missing counts as success (404-tolerant, like
 * `/v1/images/delete` — a half-deleted retry must converge). Returns null on
 * success, a `{ key, … }` failure entry otherwise.
 */
export async function deleteOne(key) {
  try {
    const res = await client().fetch(objectUrl(key), { method: "DELETE" });
    // Benign: drain the body so the socket can be reused.
    await res.body?.cancel().catch(() => {});
    if (res.ok || res.status === 404) return null;
    return { key, status: res.status };
  } catch (e) {
    return { key, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Decode an S3 ListObjectsV2 `<Key>` value (BRAWUKA-592): keys arrive
 * XML-escaped, not percent-encoded — decode entities + numeric refs in one
 * pass so `&amp;lt;` stays a literal `&lt;`, never `<`.
 */
function unescapeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#[xX]([0-9a-fA-F]+);/g, (m, named, dec, hex) => {
    if (named) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named];
    const cp = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (!Number.isSafeInteger(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    return String.fromCodePoint(cp);
  });
}

/**
 * One ListObjectsV2 page for `prefix` (BRAWUKA-730: shared by the `original/`
 * and `staging/` scans, so URL building and XML decoding exist once).
 * `lastModified` is null when the field is missing or unparsable — the caller
 * still charges that entry against its scan budget, exactly as the original
 * scan did before the extraction.
 */
async function listKeysPage({ prefix, maxKeys, cursor }) {
  const url = new URL(`${baseEndpoint()}/${r2Env.bucketName}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("max-keys", String(Math.min(1000, maxKeys)));
  if (cursor) url.searchParams.set("continuation-token", cursor);
  const res = await client().fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`ListObjectsV2 failed with ${res.status}: ${await res.text().then((t) => t.slice(0, 300))}`);
  }
  const xml = await res.text();
  const entries = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const entry = match[1];
    const rawKey = entry.match(/<Key>([^<]+)<\/Key>/)?.[1] ?? "";
    if (!rawKey) continue;
    const key = unescapeXml(rawKey);
    if (!key) continue;
    const lastModified = Date.parse(entry.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? "");
    entries.push({ key, lastModified: Number.isNaN(lastModified) ? null : lastModified });
  }
  return {
    entries,
    isTruncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    nextCursor: xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1],
  };
}

/**
 * List up to `maxEntries` objects under `prefix`, cursor-paginated. Every
 * entry the LIST returns under the prefix is charged against the budget —
 * scanned work is what the bound covers, not matches (BRAWUKA-592) — and a
 * key outside the prefix is ignored entirely, so a LIST that answers with a
 * foreign key can neither consume budget nor authorize its deletion.
 * `truncated` reports that the budget stopped the scan with work left behind.
 */
export async function listPrefixEntries({ prefix, maxEntries }) {
  const entries = [];
  let cursor;
  let truncated = false;
  let lastPageTruncated = false;
  do {
    const page = await listKeysPage({ prefix, maxKeys: maxEntries - entries.length, cursor });
    lastPageTruncated = page.isTruncated;
    for (const entry of page.entries) {
      if (!entry.key.startsWith(prefix)) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      entries.push(entry);
    }
    cursor = page.nextCursor;
    if (truncated || !cursor) break;
  } while (entries.length < maxEntries);
  // Budget hit exactly on the last entry of the final processed page: the
  // in-loop check is skipped on the `continue` path (foreign key), so
  // re-evaluate against the last page seen.
  if (!truncated && entries.length >= maxEntries && lastPageTruncated) {
    truncated = true;
  }
  return { entries, truncated };
}
