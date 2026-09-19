import { describe, expect, it } from "vitest";
import {
  ACCESS_CLIENT_ID_HEADER,
  ACCESS_CLIENT_SECRET_HEADER,
  resolveAccessHeaders,
  toCdpExtraHeaders,
  toPlaywrightExtraHeaders,
} from "../../../scripts/agent-qa/access-headers.mjs";

const PAIR = { clientId: "id-1", clientSecret: "secret-1" };

describe("resolveAccessHeaders", () => {
  it("returns the service-token pair from env", () => {
    expect(
      resolveAccessHeaders({ CF_ACCESS_CLIENT_ID: "id-1", CF_ACCESS_CLIENT_SECRET: "secret-1" }),
    ).toEqual(PAIR);
  });

  it("fails closed listing every missing variable", () => {
    expect(() => resolveAccessHeaders({})).toThrow(
      /CF_ACCESS_CLIENT_ID[\s\S]*CF_ACCESS_CLIENT_SECRET/,
    );
    expect(() => resolveAccessHeaders({ CF_ACCESS_CLIENT_ID: "id-1" })).toThrow(
      /CF_ACCESS_CLIENT_SECRET/,
    );
  });
});

describe("header shapes", () => {
  it("emits the CDP Network.setExtraHTTPHeaders shape", () => {
    expect(toCdpExtraHeaders(PAIR)).toEqual({
      headers: {
        [ACCESS_CLIENT_ID_HEADER]: "id-1",
        [ACCESS_CLIENT_SECRET_HEADER]: "secret-1",
      },
    });
  });

  it("emits the Playwright extraHTTPHeaders shape", () => {
    expect(toPlaywrightExtraHeaders(PAIR)).toEqual({
      [ACCESS_CLIENT_ID_HEADER]: "id-1",
      [ACCESS_CLIENT_SECRET_HEADER]: "secret-1",
    });
  });
});
