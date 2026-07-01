import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { drainN8nOutbox } from "@/lib/n8n-dispatcher";

function isAuthorized(request: Request): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get("x-cron-secret") ?? "";
  const expectedBuf = Buffer.from(expected);
  const suppliedBuf = Buffer.from(supplied);
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  );
}

export async function GET(request: Request) {
  if (!process.env.AUTOMATION_CRON_SECRET) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainN8nOutbox();
  return NextResponse.json(result);
}
