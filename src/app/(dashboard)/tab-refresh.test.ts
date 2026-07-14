import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("dashboard tab switching", () => {
  it("does not resync the inbox on tab visibility changes", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(dashboard)/inbox/page.tsx"),
      "utf8",
    );

    expect(source).not.toContain('addEventListener("visibilitychange"');
    expect(source).not.toContain("addEventListener('visibilitychange'");
  });

  it("does not use full document reload retry buttons in dashboard pages", () => {
    for (const page of ["broadcasts/page.tsx", "automations/page.tsx"]) {
      const source = readFileSync(
        join(process.cwd(), "src/app/(dashboard)", page),
        "utf8",
      );
      expect(source).not.toContain("window.location.reload");
      expect(source).not.toContain("location.reload");
    }
  });
});
