/**
 * PMTiles archive reader over the R2 binding (BRAWUKA-313).
 *
 * Follows the official Protomaps Cloudflare template
 * (`protomaps/PMTiles`, `serverless/cloudflare/src/index.ts`): the `pmtiles`
 * npm library reads directory + tile byte ranges out of the archive via a
 * `Source` adapter, so the Worker serves tile BYTES — never redirects to
 * per-tile objects that do not exist. One R2 object per planet version
 * (`planet/{version}/planet.pmtiles`, immutable); the live version comes
 * from the `PLANET_VERSION` env value.
 */

import { EtagMismatch, PMTiles, RangeResponse, ResolvedValueCache, Source } from "pmtiles";
import type { Env } from "./types";

export class ArchiveNotFoundError extends Error {}

// Directory cache only — tile payloads use the pmtiles defaultDecompress
// (platform DecompressionStream), exactly like the official template.
const DIRECTORY_CACHE = new ResolvedValueCache(25);

class R2Source implements Source {
  constructor(
    private readonly env: Env,
    private readonly archiveKey: string,
  ) {}

  getKey(): string {
    return this.archiveKey;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const obj = await this.env.TILES_BUCKET.get(this.archiveKey, {
      range: { offset, length },
      onlyIf: { etagMatches: etag },
    });
    if (!obj) throw new ArchiveNotFoundError(`Archive not found: ${this.archiveKey}`);
    if (!obj.body) throw new EtagMismatch();
    return { data: await obj.arrayBuffer(), etag: obj.etag };
  }
}

/** Archive key for a planet version (the only per-version tile object). */
export function archiveKey(version: string): string {
  return `planet/${version}/planet.pmtiles`;
}

/** Open the live (or pinned) planet archive for range reads. */
export function openArchive(env: Env, version?: string): PMTiles {
  return new PMTiles(new R2Source(env, archiveKey(version ?? env.PLANET_VERSION)), DIRECTORY_CACHE);
}
