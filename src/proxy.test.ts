import { describe, expect, it } from "vitest";
import { PROTECTED_PAGE_PREFIXES } from "./proxy";

describe("proxy protected route coverage", () => {
  it("includes the real-estate and workflow dashboard routes", () => {
    expect(PROTECTED_PAGE_PREFIXES).toEqual(
      expect.arrayContaining([
        "/flows",
        "/n8n-workflows",
        "/properties",
        "/appointments",
      ]),
    );
  });
});
