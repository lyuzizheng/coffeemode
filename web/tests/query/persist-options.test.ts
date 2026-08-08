import { describe, expect, it } from "vitest";
import { persistOptions } from "@/lib/query/persist-options";
import { idbPersister } from "@/lib/query/persister";

describe("persistOptions", () => {
  it("includes a buster string to invalidate stale persisted cache", () => {
    expect(persistOptions.buster).toBe("v1");
  });

  it("uses the IndexedDB persister and a 7-day max age", () => {
    expect(persistOptions.persister).toBe(idbPersister);
    expect(persistOptions.maxAge).toBe(1000 * 60 * 60 * 24 * 7);
  });

  it("only dehydrates allow-listed query keys", () => {
    const shouldDehydrate = persistOptions.dehydrateOptions?.shouldDehydrateQuery;
    expect(shouldDehydrate).toBeDefined();
    expect(shouldDehydrate?.({ queryKey: ["profile"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(true);
    expect(shouldDehydrate?.({ queryKey: ["unknown"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
  });
});
