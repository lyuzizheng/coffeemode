import { describe, expect, it } from "vitest";
import { isPostgresUnavailableError } from "./setup";

describe("isPostgresUnavailableError (tests/setup.ts error narrowing)", () => {
  it.each([
    ["ECONNREFUSED", { code: "ECONNREFUSED" }],
    ["ENOTFOUND", { code: "ENOTFOUND" }],
    ["EHOSTUNREACH", { code: "EHOSTUNREACH" }],
    ["ETIMEDOUT", { code: "ETIMEDOUT" }],
    ["ECONNRESET", { code: "ECONNRESET" }],
    ["EPIPE", { code: "EPIPE" }],
    ["EAI_AGAIN", { code: "EAI_AGAIN" }],
    ["42P01 (undefined_table before rate_limits migration)", { code: "42P01" }],
  ])("identifies code %s as expected Postgres unready/unprovisioned error", (_name, err) => {
    expect(isPostgresUnavailableError(err)).toBe(true);
  });

  it.each([
    ["connect ECONNREFUSED 127.0.0.1:5432", new Error("connect ECONNREFUSED 127.0.0.1:5432")],
    ["getaddrinfo ENOTFOUND localhost", new Error("getaddrinfo ENOTFOUND localhost")],
    ["connect EHOSTUNREACH 192.168.1.1", new Error("connect EHOSTUNREACH 192.168.1.1")],
    ["connect ETIMEDOUT 10.0.0.1", new Error("connect ETIMEDOUT 10.0.0.1")],
    ["read ECONNRESET", new Error("read ECONNRESET")],
    ["Connection terminated unexpectedly", new Error("Connection terminated unexpectedly")],
    ["connection timeout expired", new Error("connection timeout expired")],
    ["connect timeout expired", new Error("connect timeout expired")],
    ["could not connect to server: Connection refused", new Error("could not connect to server: Connection refused")],
    ["server closed the connection unexpectedly", new Error("server closed the connection unexpectedly")],
    ["relation \"rate_limits\" does not exist", new Error("relation \"rate_limits\" does not exist")],
  ])("identifies message '%s' as expected Postgres unready/unprovisioned error", (_name, err) => {
    expect(isPostgresUnavailableError(err)).toBe(true);
  });

  it.each([
    ["TypeError", new TypeError("Cannot read properties of undefined (reading 'reset')")],
    ["ReferenceError", new ReferenceError("rateLimiter is not defined")],
    ["SyntaxError", new SyntaxError("Unexpected token in JSON")],
    ["SQL syntax error (42601)", { code: "42601", message: "syntax error at or near 'DELETE'" }],
    ["Auth error (28P01)", { code: "28P01", message: "password authentication failed for user" }],
    ["Database not found (3D000)", { code: "3D000", message: "database 'coffeemode_test' does not exist" }],
    ["Permission denied (42501)", { code: "42501", message: "permission denied for table rate_limits" }],
    ["Config error", new Error("DATABASE_URL is not set")],
    ["Generic failure", new Error("Unexpected test runner crash")],
    ["Plain string", "something went wrong"],
    ["null", null],
    ["undefined", undefined],
    ["number", 500],
  ])("rejects genuine configuration or runtime regression: %s (must re-throw)", (_name, err) => {
    expect(isPostgresUnavailableError(err)).toBe(false);
  });
});
