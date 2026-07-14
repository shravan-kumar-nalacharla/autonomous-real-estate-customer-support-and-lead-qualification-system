import { afterEach, describe, expect, it } from "vitest";
import { isInternalRequestAuthorized, isUuid } from "./internal-secret";

describe("isInternalRequestAuthorized", () => {
  const originalSecret = process.env.N8N_INTERNAL_SECRET;

  afterEach(() => {
    process.env.N8N_INTERNAL_SECRET = originalSecret;
  });

  it("accepts the exact internal secret", () => {
    process.env.N8N_INTERNAL_SECRET = "super-secret";
    const request = new Request("https://huygen.test", {
      headers: { "x-internal-secret": "super-secret" },
    });

    expect(isInternalRequestAuthorized(request)).toBe(true);
  });

  it("rejects missing or mismatched secrets", () => {
    process.env.N8N_INTERNAL_SECRET = "super-secret";

    expect(isInternalRequestAuthorized(new Request("https://huygen.test"))).toBe(
      false,
    );
    expect(
      isInternalRequestAuthorized(
        new Request("https://huygen.test", {
          headers: { "x-internal-secret": "wrong" },
        }),
      ),
    ).toBe(false);
  });
});

describe("isUuid", () => {
  it("validates UUID-shaped route inputs", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
