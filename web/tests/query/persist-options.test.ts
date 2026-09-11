import { describe, expect, it } from "vitest";
import { persistOptions } from "@/lib/query/persist-options";
import { PERSISTED_QUERY_KEYS } from "@/lib/query/keys";
import { idbPersister } from "@/lib/query/persister";

describe("persistOptions", () => {
  it("uses the IndexedDB persister, non-empty buster, and valid retention window", () => {
    expect(persistOptions.persister).toBe(idbPersister);
    expect(typeof persistOptions.persister.persistClient).toBe("function");
    expect(typeof persistOptions.persister.restoreClient).toBe("function");
    expect(typeof persistOptions.persister.removeClient).toBe("function");
    expect(typeof persistOptions.maxAge).toBe("number");
    expect(persistOptions.maxAge).toBeGreaterThan(0);
    expect(typeof persistOptions.buster).toBe("string");
    expect(persistOptions.buster).toBeTruthy();
  });

  it("only dehydrates allow-listed query keys (profile, cafe, cafes-list) and rejects unlisted keys", () => {
    const shouldDehydrate = persistOptions.dehydrateOptions?.shouldDehydrateQuery;
    expect(shouldDehydrate).toBeDefined();

    // Ensure persisted query key contract is non-empty and matches explicit business entities
    expect(PERSISTED_QUERY_KEYS).toEqual(["profile", "cafe", "cafes-list"]);

    expect(shouldDehydrate?.({ queryKey: ["profile"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(true);
    expect(shouldDehydrate?.({ queryKey: ["cafe", "cafe-123"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(true);
    expect(shouldDehydrate?.({ queryKey: ["cafes-list", { city: "singapore" }] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(true);

    expect(shouldDehydrate?.({ queryKey: ["unknown"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
    expect(shouldDehydrate?.({ queryKey: ["checkins"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
    expect(shouldDehydrate?.({ queryKey: [] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
  });
});
