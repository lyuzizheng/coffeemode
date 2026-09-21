import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { get, set, createStore } from "idb-keyval";
import { idbPersister } from "@/lib/query/persister";

const PERSISTER_KEY = "coffeemode-persisted-client";
const queryStore = createStore("coffeemode-query-cache", "queries");

const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");

function stubCookies(header: string) {
  Object.defineProperty(document, "cookie", {
    get: () => header,
    configurable: true,
  });
}

function authCookie(userId: string): string {
  const session = Buffer.from(JSON.stringify({ user: { id: userId } })).toString("base64url");
  return `sb-project-auth-token=base64-${session}`;
}

function persistedClient(tag: string): PersistedClient {
  return {
    buster: "v1",
    timestamp: Date.now(),
    clientState: {
      queries: [{ queryKey: ["profile", tag], state: { status: "success", data: tag } }],
      mutations: [],
    },
  } as unknown as PersistedClient;
}

describe("idbPersister viewer scoping (BRAWUKA-573)", () => {
  beforeEach(async () => {
    stubCookies("");
    await idbPersister.removeClient();
  });

  afterEach(() => {
    if (cookieDescriptor) {
      Object.defineProperty(document, "cookie", cookieDescriptor);
    }
  });

  it("restores a cache written by the same viewer", async () => {
    stubCookies(authCookie("user-a"));
    await idbPersister.persistClient(persistedClient("a-data"));

    const restored = await idbPersister.restoreClient();
    expect(restored?.clientState.queries[0]?.queryKey).toEqual(["profile", "a-data"]);
  });

  it("refuses and deletes a cache owned by a different viewer", async () => {
    stubCookies(authCookie("user-a"));
    await idbPersister.persistClient(persistedClient("a-data"));

    // Account B signs in on the same device.
    stubCookies(authCookie("user-b"));
    expect(await idbPersister.restoreClient()).toBeUndefined();
    expect(await get(PERSISTER_KEY, queryStore)).toBeUndefined();
  });

  it("refuses a viewer-owned cache once signed out (anonymous)", async () => {
    stubCookies(authCookie("user-a"));
    await idbPersister.persistClient(persistedClient("a-data"));

    stubCookies("");
    expect(await idbPersister.restoreClient()).toBeUndefined();
    expect(await get(PERSISTER_KEY, queryStore)).toBeUndefined();
  });

  it("restores an anonymous cache only for anonymous viewers", async () => {
    await idbPersister.persistClient(persistedClient("anon-data"));
    expect((await idbPersister.restoreClient())?.clientState.queries[0]?.queryKey).toEqual([
      "profile",
      "anon-data",
    ]);

    stubCookies(authCookie("user-b"));
    expect(await idbPersister.restoreClient()).toBeUndefined();
  });

  it("drops legacy entries written before owner tagging", async () => {
    // Pre-BRAWUKA-573 shape: the bare PersistedClient under the same key.
    await set(PERSISTER_KEY, persistedClient("legacy"), queryStore);

    stubCookies(authCookie("user-a"));
    expect(await idbPersister.restoreClient()).toBeUndefined();
    expect(await get(PERSISTER_KEY, queryStore)).toBeUndefined();
  });

  it("removeClient deletes the stored entry", async () => {
    stubCookies(authCookie("user-a"));
    await idbPersister.persistClient(persistedClient("a-data"));
    await idbPersister.removeClient();
    expect(await get(PERSISTER_KEY, queryStore)).toBeUndefined();
  });
});
