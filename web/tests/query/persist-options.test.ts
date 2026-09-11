import { describe, expect, it } from "vitest";
import { persistOptions } from "@/lib/query/persist-options";
import { PERSISTED_QUERY_KEYS } from "@/lib/query/keys";

describe("persistOptions", () => {
  it("configures a persister with functional storage methods and a positive retention duration", () => {
    expect(typeof persistOptions.persister.persistClient).toBe("function");
    expect(typeof persistOptions.persister.restoreClient).toBe("function");
    expect(typeof persistOptions.persister.removeClient).toBe("function");
    expect(typeof persistOptions.maxAge).toBe("number");
    expect(persistOptions.maxAge).toBeGreaterThan(0);
    expect(typeof persistOptions.buster).toBe("string");
    expect(persistOptions.buster).toBeTruthy();
  });

  it("only dehydrates allow-listed query keys and rejects unlisted keys", () => {
    const shouldDehydrate = persistOptions.dehydrateOptions?.shouldDehydrateQuery;
    expect(shouldDehydrate).toBeDefined();

    for (const key of PERSISTED_QUERY_KEYS) {
      expect(shouldDehydrate?.({ queryKey: [key] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(true);
      expect(shouldDehydrate?.({ queryKey: [key, "sub-param", 123] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(true);
    }

    expect(shouldDehydrate?.({ queryKey: ["unknown"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
    expect(shouldDehydrate?.({ queryKey: ["checkins"] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
    expect(shouldDehydrate?.({ queryKey: [] } as unknown as Parameters<typeof shouldDehydrate>[0])).toBe(false);
  });
});
