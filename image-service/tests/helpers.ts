/// <reference types="@cloudflare/workers-types" />

type R2BodyInput =
  | ReadableStream<Uint8Array>
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null;

function readBody(input: R2BodyInput): Uint8Array {
  if (input === null) return new Uint8Array(0);
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new Error("ReadableStream inputs are consumed separately");
}

export class FakeR2Bucket implements R2Bucket {
  private store = new Map<
    string,
    {
      body: Uint8Array;
      size: number;
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
    }
  >();

  async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    let body: Uint8Array;
    if (value instanceof ReadableStream) {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const size = chunks.reduce((sum, c) => sum + c.length, 0);
      body = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        body.set(c, offset);
        offset += c.length;
      }
    } else {
      body = readBody(value);
    }

    const record = {
      body,
      size: body.length,
      httpMetadata: options?.httpMetadata as R2HTTPMetadata | undefined,
      customMetadata: options?.customMetadata as Record<string, string> | undefined,
    };
    this.store.set(key, record);

    return {
      key,
      size: record.size,
      etag: "",
      httpEtag: "",
      httpMetadata: record.httpMetadata,
      customMetadata: record.customMetadata,
      checksums: {},
      uploaded: new Date(),
      version: "",
    } as R2Object;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.store.get(key);
    if (!item) return null;

    return {
      key,
      size: item.size,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(item.body);
          controller.close();
        },
      }),
      etag: "",
      httpEtag: "",
      httpMetadata: item.httpMetadata,
      customMetadata: item.customMetadata,
      checksums: {},
      uploaded: new Date(),
      version: "",
    } as R2ObjectBody;
  }

  async head(key: string): Promise<R2Object | null> {
    const item = this.store.get(key);
    if (!item) return null;
    return {
      key,
      size: item.size,
      etag: "",
      httpEtag: "",
      httpMetadata: item.httpMetadata,
      customMetadata: item.customMetadata,
      checksums: {},
      uploaded: new Date(),
      version: "",
    } as R2Object;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(k);
    }
  }

  async list(_options?: R2ListOptions): Promise<R2Objects> {
    return { objects: [], truncated: false, delimitedPrefixes: [] };
  }

  async createMultipartUpload(_key: string, _options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    throw new Error("multipart upload not implemented in fake");
  }

  resumeMultipartUpload(_key: string, _uploadId: string): R2MultipartUpload {
    throw new Error("multipart upload not implemented in fake");
  }
}

export function baseEnv(): {
  IMAGE_SERVICE_TOKEN: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  UPLOAD_URL_TTL_SECONDS: string;
  R2_BUCKET: R2Bucket;
} {
  return {
    IMAGE_SERVICE_TOKEN: "test-token",
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    R2_BUCKET_NAME: "cafemode",
    R2_PUBLIC_URL: "https://images.coffeemode.app",
    UPLOAD_URL_TTL_SECONDS: "600",
    R2_BUCKET: new FakeR2Bucket(),
  };
}
