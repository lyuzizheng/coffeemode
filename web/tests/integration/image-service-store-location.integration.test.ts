/**
 * @vitest-environment node
 *
 * BRAWUKA-795 (review of BRAWUKA-738): `wrangler.toml` ships
 * `R2_ENDPOINT = ""` to staging and production to mean "no override", so the
 * Worker's store address must fall back to the endpoint derived from
 * `R2_ACCOUNT_ID` — emptiness, not nullishness, selects the override. The
 * defect it guards: a scheme-less address (`/bucket/key`) makes `new Request`
 * throw, so upload and complete presigning answered 500 in the deployed envs
 * while every local gate stayed green.
 *
 * The suite drives the address both signing paths read, offline for the
 * deployed bindings (virtual credentials, no production access) and against
 * the local MinIO stack for the override case.
 *
 * Requires:
 *   docker compose up -d --wait minio
 *   docker compose run --rm minio-init
 *   RUN_INTEGRATION=1 npm run test:integration:images
 *
 * Without RUN_INTEGRATION=1 the suite is skipped (not passed), the same as the
 * storage suites it ships next to. The Worker's `Env` stays out of this
 * program — `image-service/src/types.ts` types `R2_BUCKET` with Cloudflare's
 * `R2Bucket` global — which is why the address policy lives in the
 * globals-free `store-location` module this suite imports.
 */
import { randomUUID } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  objectUrl,
  presignedGetUrl,
  presignedPutUrl,
  type PresignConfig,
} from "@shared/images/presign";
import { storeLocation, type StoreBindings } from "../../../image-service/src/store-location";
import {
  R2_ACCESS_KEY_ID,
  R2_BUCKET_NAME,
  R2_ENDPOINT,
  R2_SECRET_ACCESS_KEY,
  deleteObject,
  makePayload,
  minioReachable,
} from "../helpers/r2";

// Storage suites never touch the rate limiter (in-memory only, BRAWUKA-378).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeStore = RUN_INTEGRATION ? describe : describe.skip;

/** `wrangler.toml` `[env.staging]` vars, verbatim apart from the account id. */
const DEPLOYED: StoreBindings = {
  R2_ACCOUNT_ID: "example-account",
  R2_BUCKET_NAME: "coffeemode-images-staging",
  R2_ENDPOINT: "",
};
const DERIVED_ENDPOINT = "https://example-account.r2.cloudflarestorage.com";
const KEY = "staging/2f1c0c9a-9d1e-4a2c-9b8f-5d1b2a7c4e10.webp";

let minioUp = false;
let minioKey = "";

/** The Worker adapter's config, minus its `Env` type (Cloudflare globals). */
function configFor(bindings: StoreBindings): PresignConfig {
  return {
    ...storeLocation(bindings),
    signer: new AwsClient({
      service: "s3",
      region: "auto",
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    }),
  };
}

describeStore("integration — Worker store address resolution (BRAWUKA-795)", () => {
  beforeAll(async () => {
    minioUp = await minioReachable();
  });

  afterAll(async () => {
    if (minioKey) await deleteObject(minioKey);
  });

  it("derives the R2 endpoint when no override is set", async () => {
    const bindings: StoreBindings = {
      R2_ACCOUNT_ID: DEPLOYED.R2_ACCOUNT_ID,
      R2_BUCKET_NAME: DEPLOYED.R2_BUCKET_NAME,
    };
    expect(storeLocation(bindings)).toEqual({
      endpoint: DERIVED_ENDPOINT,
      bucket: DEPLOYED.R2_BUCKET_NAME,
    });
    expect(objectUrl(storeLocation(bindings), KEY)).toBe(
      `${DERIVED_ENDPOINT}/${DEPLOYED.R2_BUCKET_NAME}/${KEY}`,
    );
    const put = await presignedPutUrl(configFor(bindings), KEY, "image/webp", {
      expiresSeconds: 600,
      contentLength: 64,
    });
    const get = await presignedGetUrl(configFor(bindings), KEY, 600);
    expect(new URL(put.url).host).toBe(new URL(DERIVED_ENDPOINT).host);
    expect(new URL(put.url).searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(new URL(get.url).host).toBe(new URL(DERIVED_ENDPOINT).host);
    expect(new URL(get.url).searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("treats the empty override the deployed envs ship as no override", async () => {
    expect(storeLocation(DEPLOYED)).toEqual({
      endpoint: DERIVED_ENDPOINT,
      bucket: DEPLOYED.R2_BUCKET_NAME,
    });
    const target = objectUrl(storeLocation(DEPLOYED), KEY);
    expect(target).toBe(`${DERIVED_ENDPOINT}/${DEPLOYED.R2_BUCKET_NAME}/${KEY}`);
    // The defect this guards: an address without a scheme throws here and in
    // `new Request` inside both presigners.
    expect(() => new URL(target)).not.toThrow();
    const put = await presignedPutUrl(configFor(DEPLOYED), KEY, "image/webp", {
      expiresSeconds: 600,
      contentLength: 64,
    });
    const get = await presignedGetUrl(configFor(DEPLOYED), KEY, 600);
    expect(new URL(put.url).host).toBe(new URL(DERIVED_ENDPOINT).host);
    expect(new URL(get.url).host).toBe(new URL(DERIVED_ENDPOINT).host);
    expect(new URL(get.url).searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(objectUrl(storeLocation(DEPLOYED), KEY)).toBe(objectUrl(storeLocation({ ...DEPLOYED, R2_ENDPOINT: undefined }), KEY));
  });

  it("signs a PUT/GET pair a trailing-slash MinIO override accepts", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const bindings: StoreBindings = {
      R2_ACCOUNT_ID: "local",
      R2_BUCKET_NAME,
      R2_ENDPOINT: `${R2_ENDPOINT}/`,
    };
    minioKey = `staging/${randomUUID()}.webp`;
    const payload = makePayload(256);
    const put = await presignedPutUrl(configFor(bindings), minioKey, "image/webp", {
      expiresSeconds: 600,
      contentLength: payload.length,
    });
    expect(put.url.startsWith(`${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET_NAME}/${minioKey}`)).toBe(true);
    const putRes = await fetch(put.url, {
      method: "PUT",
      headers: put.headers,
      body: payload as unknown as BodyInit,
    });
    expect(putRes.ok).toBe(true);
    const get = await presignedGetUrl(configFor(bindings), minioKey, 600);
    const getRes = await fetch(get.url, { headers: get.headers });
    expect(getRes.ok).toBe(true);
    expect(Buffer.from(await getRes.arrayBuffer())).toEqual(Buffer.from(payload));
  });
});
