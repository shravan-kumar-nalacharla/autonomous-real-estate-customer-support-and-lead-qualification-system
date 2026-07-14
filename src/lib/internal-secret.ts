import { timingSafeEqual } from "node:crypto";

export function isInternalRequestAuthorized(request: Request): boolean {
  const expected = process.env.N8N_INTERNAL_SECRET;
  if (!expected) return false;

  const got = request.headers.get("x-internal-secret") ?? "";
  const expectedBuffer = Buffer.from(expected);
  const gotBuffer = Buffer.from(got);

  if (expectedBuffer.length !== gotBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, gotBuffer);
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
