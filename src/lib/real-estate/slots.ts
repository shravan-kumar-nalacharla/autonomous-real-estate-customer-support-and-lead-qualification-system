import type { SupabaseClient } from "@supabase/supabase-js";

export interface AppointmentSlot {
  start_at: string;
  end_at: string;
  agent_id: string | null;
  available: boolean;
}

interface GenerateSlotsArgs {
  db: SupabaseClient;
  organizationId: string;
  date: string;
  propertyId?: string | null;
  agentId?: string | null;
  durationMinutes?: number | null;
}

interface TimeRange {
  start: Date;
  end: Date;
  agentId: string | null;
}

export async function generateAppointmentSlots(
  args: GenerateSlotsArgs,
): Promise<AppointmentSlot[]> {
  const duration = await resolveDuration(args);
  const day = parseDateOnly(args.date);
  const weekday = day.getUTCDay();
  const [organizationResult, rulesResult, timeOffResult, appointmentsResult, locksResult] =
    await Promise.all([
      args.db
        .from("organizations")
        .select("business_hours, timezone")
        .eq("id", args.organizationId)
        .maybeSingle(),
      args.db
        .from("agent_availability_rules")
        .select("*")
        .eq("organization_id", args.organizationId)
        .eq("weekday", weekday)
        .eq("is_active", true),
      args.db
        .from("agent_time_off")
        .select("agent_id, starts_at, ends_at")
        .eq("organization_id", args.organizationId)
        .lt("starts_at", dayEnd(day).toISOString())
        .gt("ends_at", day.toISOString()),
      args.db
        .from("appointments")
        .select("assigned_agent_id, status, proposed_start_at, confirmed_start_at")
        .eq("organization_id", args.organizationId)
        .in("status", ["proposed", "confirmed"])
        .or(
          `proposed_start_at.gte.${day.toISOString()},confirmed_start_at.gte.${day.toISOString()}`,
        ),
      args.db
        .from("appointment_slot_locks")
        .select("agent_id, slot_start_at, slot_end_at, expires_at, status")
        .eq("organization_id", args.organizationId)
        .in("status", ["held", "confirmed"])
        .gt("expires_at", new Date().toISOString()),
    ]);

  if (organizationResult.error) throw new Error(organizationResult.error.message);
  if (rulesResult.error) throw new Error(rulesResult.error.message);
  if (timeOffResult.error) throw new Error(timeOffResult.error.message);
  if (appointmentsResult.error) throw new Error(appointmentsResult.error.message);
  if (locksResult.error) throw new Error(locksResult.error.message);

  const businessHours = (organizationResult.data as { business_hours?: unknown } | null)
    ?.business_hours;
  const windows = buildWindows({
    day,
    weekday,
    businessHours,
    rules: (rulesResult.data ?? []) as Array<Record<string, unknown>>,
    agentId: args.agentId ?? null,
  });

  const busyRanges = [
    ...((timeOffResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      start: new Date(String(row.starts_at)),
      end: new Date(String(row.ends_at)),
      agentId: (row.agent_id as string | null) ?? null,
    })),
    ...((appointmentsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.confirmed_start_at ?? row.proposed_start_at)
      .filter(Boolean)
      .map((value, index) => ({
        start: new Date(String(value)),
        end: addMinutes(new Date(String(value)), duration),
        agentId:
          (((appointmentsResult.data ?? []) as Array<Record<string, unknown>>)[index]
            ?.assigned_agent_id as string | null) ?? null,
      })),
    ...((locksResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      start: new Date(String(row.slot_start_at)),
      end: new Date(String(row.slot_end_at)),
      agentId: (row.agent_id as string | null) ?? null,
    })),
  ];

  const slots: AppointmentSlot[] = [];
  for (const window of windows) {
    for (
      let cursor = new Date(window.start);
      addMinutes(cursor, duration) <= window.end;
      cursor = addMinutes(cursor, 30)
    ) {
      const slotEnd = addMinutes(cursor, duration);
      const conflicts = busyRanges.some(
        (busy) =>
          sameAgentOrUnassigned(window.agentId, busy.agentId) &&
          rangesOverlap(cursor, slotEnd, busy.start, busy.end),
      );
      if (!conflicts) {
        slots.push({
          start_at: cursor.toISOString(),
          end_at: slotEnd.toISOString(),
          agent_id: window.agentId,
          available: true,
        });
      }
    }
  }

  return slots.slice(0, 60);
}

export async function assertSlotAvailable(args: {
  db: SupabaseClient;
  organizationId: string;
  slotStartAt: string;
  slotEndAt: string;
  agentId?: string | null;
}) {
  const start = new Date(args.slotStartAt);
  const end = new Date(args.slotEndAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return false;
  }

  const [appointmentsResult, locksResult, timeOffResult] = await Promise.all([
    args.db
      .from("appointments")
      .select("assigned_agent_id, proposed_start_at, confirmed_start_at")
      .eq("organization_id", args.organizationId)
      .in("status", ["proposed", "confirmed"]),
    args.db
      .from("appointment_slot_locks")
      .select("agent_id, slot_start_at, slot_end_at")
      .eq("organization_id", args.organizationId)
      .in("status", ["held", "confirmed"])
      .gt("expires_at", new Date().toISOString()),
    args.db
      .from("agent_time_off")
      .select("agent_id, starts_at, ends_at")
      .eq("organization_id", args.organizationId)
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString()),
  ]);

  if (appointmentsResult.error || locksResult.error || timeOffResult.error) return false;
  const busyRanges: TimeRange[] = [
    ...((appointmentsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.confirmed_start_at ?? row.proposed_start_at)
      .filter(Boolean)
      .map((value, index) => ({
        start: new Date(String(value)),
        end: addMinutes(new Date(String(value)), minutesBetween(start, end)),
        agentId:
          (((appointmentsResult.data ?? []) as Array<Record<string, unknown>>)[index]
            ?.assigned_agent_id as string | null) ?? null,
      })),
    ...((locksResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      start: new Date(String(row.slot_start_at)),
      end: new Date(String(row.slot_end_at)),
      agentId: (row.agent_id as string | null) ?? null,
    })),
    ...((timeOffResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      start: new Date(String(row.starts_at)),
      end: new Date(String(row.ends_at)),
      agentId: (row.agent_id as string | null) ?? null,
    })),
  ];

  return !busyRanges.some(
    (busy) =>
      sameAgentOrUnassigned(args.agentId ?? null, busy.agentId) &&
      rangesOverlap(start, end, busy.start, busy.end),
  );
}

async function resolveDuration(args: GenerateSlotsArgs) {
  if (args.durationMinutes && args.durationMinutes > 0) return args.durationMinutes;
  if (args.propertyId) {
    const { data } = await args.db
      .from("property_visit_settings")
      .select("default_visit_duration_minutes, travel_buffer_minutes")
      .eq("property_id", args.propertyId)
      .maybeSingle();
    const row = data as
      | { default_visit_duration_minutes?: number; travel_buffer_minutes?: number }
      | null;
    if (row?.default_visit_duration_minutes) {
      return row.default_visit_duration_minutes + (row.travel_buffer_minutes ?? 0);
    }
  }
  return 45;
}

function buildWindows(args: {
  day: Date;
  weekday: number;
  businessHours: unknown;
  rules: Array<Record<string, unknown>>;
  agentId: string | null;
}): TimeRange[] {
  const ruleWindows = args.rules
    .filter((rule) => !args.agentId || rule.agent_id === args.agentId)
    .map((rule) => ({
      start: dateAtTime(args.day, String(rule.start_time)),
      end: dateAtTime(args.day, String(rule.end_time)),
      agentId: (rule.agent_id as string | null) ?? null,
    }));
  if (ruleWindows.length > 0) return ruleWindows;

  const hours = args.businessHours as
    | { days?: number[]; start?: string; end?: string }
    | null
    | undefined;
  const days = hours?.days ?? [1, 2, 3, 4, 5, 6];
  if (!days.includes(args.weekday)) return [];
  return [
    {
      start: dateAtTime(args.day, hours?.start ?? "09:00"),
      end: dateAtTime(args.day, hours?.end ?? "18:00"),
      agentId: args.agentId,
    },
  ];
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function dateAtTime(day: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(day);
  result.setUTCHours(hours || 0, minutes || 0, 0, 0);
  return result;
}

function dayEnd(day: Date) {
  return addMinutes(day, 24 * 60);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function sameAgentOrUnassigned(a: string | null, b: string | null) {
  return !a || !b || a === b;
}
