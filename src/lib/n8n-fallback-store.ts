import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { N8nSettingsRecord, N8nWorkflowRecord } from "@/lib/n8n-types";

const WORKFLOW_PREFIX = "n8nwf:";
const SETTINGS_PREFIX = "n8nset:";

interface ParsedFallbackState {
  passthrough: string[];
  workflows: N8nWorkflowRecord[];
  settings: N8nSettingsRecord | null;
}

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  beta_features: string[] | null;
}

function encodePayload(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePayload<T>(value: string): T | null {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function parseFallbackState(betaFeatures: string[] | null | undefined): ParsedFallbackState {
  const input = betaFeatures ?? [];
  const passthrough: string[] = [];
  const workflows: N8nWorkflowRecord[] = [];
  let settings: N8nSettingsRecord | null = null;

  for (const token of input) {
    if (token.startsWith(WORKFLOW_PREFIX)) {
      const payload = decodePayload<N8nWorkflowRecord>(
        token.slice(WORKFLOW_PREFIX.length),
      );
      if (payload?.id) workflows.push(payload);
      continue;
    }

    if (token.startsWith(SETTINGS_PREFIX)) {
      const payload = decodePayload<N8nSettingsRecord>(
        token.slice(SETTINGS_PREFIX.length),
      );
      if (payload?.id) settings = payload;
      continue;
    }

    passthrough.push(token);
  }

  return { passthrough, workflows, settings };
}

function composeBetaFeatures(state: ParsedFallbackState): string[] {
  const encodedWorkflows = state.workflows.map(
    (workflow) => `${WORKFLOW_PREFIX}${encodePayload(workflow)}`,
  );
  const encodedSettings = state.settings
    ? [`${SETTINGS_PREFIX}${encodePayload(state.settings)}`]
    : [];
  return [...state.passthrough, ...encodedWorkflows, ...encodedSettings];
}

export function isMissingN8nTableError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code !== "PGRST205") return false;
  const message = error.message ?? "";
  return (
    message.includes("public.n8n_workflows") ||
    message.includes("public.n8n_settings")
  );
}

async function getProfileRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .schema("public")
    .from("profiles")
    .select("id, user_id, full_name, email, beta_features")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error(
      "Profile row is missing for this user. Please sign out and sign in again.",
    );
  }
  return data as ProfileRow;
}

async function saveFallbackState(
  supabase: SupabaseClient,
  profile: ProfileRow,
  state: ParsedFallbackState,
) {
  const betaFeatures = composeBetaFeatures(state);
  const { error } = await supabase
    .schema("public")
    .from("profiles")
    .update({
      beta_features: betaFeatures,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  if (error) throw error;
}

export async function getFallbackWorkflows(
  supabase: SupabaseClient,
  userId: string,
): Promise<N8nWorkflowRecord[]> {
  const profile = await getProfileRow(supabase, userId);
  const state = parseFallbackState(profile.beta_features);
  return state.workflows.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
}

export async function createFallbackWorkflow(
  supabase: SupabaseClient,
  userId: string,
  input: Partial<N8nWorkflowRecord> & Pick<N8nWorkflowRecord, "name" | "webhook_url" | "trigger_event">,
): Promise<N8nWorkflowRecord> {
  const profile = await getProfileRow(supabase, userId);
  const state = parseFallbackState(profile.beta_features);
  const now = new Date().toISOString();

  const workflow: N8nWorkflowRecord = {
    id: randomUUID(),
    name: input.name,
    description: input.description ?? null,
    workflow_id: input.workflow_id ?? null,
    webhook_url: input.webhook_url,
    trigger_event: input.trigger_event,
    is_active: input.is_active ?? true,
    n8n_instance_url: input.n8n_instance_url ?? null,
    secret_token: input.secret_token ?? null,
    last_triggered_at: input.last_triggered_at ?? null,
    last_status_code: input.last_status_code ?? null,
    last_error: input.last_error ?? null,
    execution_count: input.execution_count ?? 0,
    created_at: now,
    updated_at: now,
  };

  state.workflows = [workflow, ...state.workflows];
  await saveFallbackState(supabase, profile, state);
  return workflow;
}

export async function getFallbackWorkflowById(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<N8nWorkflowRecord | null> {
  const workflows = await getFallbackWorkflows(supabase, userId);
  return workflows.find((workflow) => workflow.id === id) ?? null;
}

export async function updateFallbackWorkflow(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  updates: Partial<N8nWorkflowRecord>,
): Promise<N8nWorkflowRecord | null> {
  const profile = await getProfileRow(supabase, userId);
  const state = parseFallbackState(profile.beta_features);
  const index = state.workflows.findIndex((workflow) => workflow.id === id);
  if (index === -1) return null;

  const existing = state.workflows[index];
  const updated: N8nWorkflowRecord = {
    ...existing,
    ...updates,
    id: existing.id,
    updated_at: new Date().toISOString(),
  };
  state.workflows[index] = updated;
  await saveFallbackState(supabase, profile, state);
  return updated;
}

export async function deleteFallbackWorkflow(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const profile = await getProfileRow(supabase, userId);
  const state = parseFallbackState(profile.beta_features);
  const before = state.workflows.length;
  state.workflows = state.workflows.filter((workflow) => workflow.id !== id);
  if (state.workflows.length === before) return false;
  await saveFallbackState(supabase, profile, state);
  return true;
}

export async function getFallbackSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<N8nSettingsRecord | null> {
  const profile = await getProfileRow(supabase, userId);
  const state = parseFallbackState(profile.beta_features);
  return state.settings;
}

export async function upsertFallbackSettings(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<N8nSettingsRecord>,
): Promise<N8nSettingsRecord> {
  const profile = await getProfileRow(supabase, userId);
  const state = parseFallbackState(profile.beta_features);
  const now = new Date().toISOString();
  const base: N8nSettingsRecord =
    state.settings ??
    ({
      id: randomUUID(),
      instance_url: null,
      api_key: null,
      is_connected: false,
      last_ping_at: null,
      last_ping_status: null,
      created_at: now,
      updated_at: now,
    } as N8nSettingsRecord);

  const next: N8nSettingsRecord = {
    ...base,
    ...updates,
    id: base.id,
    created_at: base.created_at ?? now,
    updated_at: now,
  };

  state.settings = next;
  await saveFallbackState(supabase, profile, state);
  return next;
}
