"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  BrainCircuit,
  Building2,
  CalendarCheck2,
  Check,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { AGENT_TEAM, type AgentId, type AgentRuntimeSummary } from "@/lib/real-estate/agent-team";
import { cn } from "@/lib/utils";

interface TimelineItem {
  id: string;
  agentId: AgentId;
  action_type: string;
  output_summary: string | null;
  confidence: number | null;
  created_at: string;
}

interface OverviewResponse {
  agents: AgentRuntimeSummary[];
  timeline: TimelineItem[];
  generatedAt: string;
  error?: string;
}

const iconByAgent: Record<AgentId, typeof Bot> = {
  concierge: BrainCircuit,
  qualification: Sparkles,
  property: Building2,
  visit: CalendarCheck2,
  handoff: Users,
};

const accentByAgent: Record<AgentId, string> = {
  concierge: "bg-violet-500/10 text-violet-500 ring-violet-500/20",
  qualification: "bg-sky-500/10 text-sky-500 ring-sky-500/20",
  property: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
  visit: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
  handoff: "bg-rose-500/10 text-rose-500 ring-rose-500/20",
};

export default function AgentsPage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agents/overview", { cache: "no-store" });
      const json = (await response.json()) as OverviewResponse;
      if (!response.ok) throw new Error(json.error ?? "Could not load agent activity");
      setOverview(json);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load agent activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const summaries = useMemo(
    () => new Map(overview?.agents.map((agent) => [agent.id, agent]) ?? []),
    [overview],
  );
  const totalRuns = overview?.agents.reduce((sum, agent) => sum + agent.runs24h, 0) ?? 0;
  const activeAgents = overview?.agents.filter((agent) => isWorking(agent.lastActivityAt)).length ?? 0;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)] sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Five-agent architecture
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">AI Agent Team</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)] sm:text-base">
              Five specialized agents collaborate from first enquiry to qualified lead,
              matched property, site visit, and human handoff.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh activity
          </button>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:max-w-xl">
          <Stat value="5" label="Specialist agents" />
          <Stat value={String(activeAgents)} label="Working now" />
          <Stat value={String(totalRuns)} label="Runs in 24h" />
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--radius-md)] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          {error}
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Live collaboration flow</h2>
            <p className="text-sm text-[var(--text-secondary)]">Each stage has its own responsibility and audit trail.</p>
          </div>
          <span className="hidden text-xs text-[var(--text-tertiary)] sm:block">WhatsApp enquiry → human-ready outcome</span>
        </div>

        <div className="grid gap-3 lg:grid-cols-5">
          {AGENT_TEAM.map((agent, index) => {
            const Icon = iconByAgent[agent.id];
            const summary = summaries.get(agent.id);
            const working = isWorking(summary?.lastActivityAt ?? null);
            return (
              <div key={agent.id} className="relative flex min-w-0">
                <article className="flex w-full flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl ring-1", accentByAgent[agent.id])}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium",
                      working ? "bg-emerald-500/10 text-emerald-500" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
                    )}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", working ? "animate-pulse bg-emerald-500" : "bg-[var(--text-tertiary)]")} />
                      {working ? "Working" : "Ready"}
                    </span>
                  </div>
                  <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Agent {index + 1}</div>
                  <h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{agent.name}</h3>
                  <p className="mt-2 min-h-16 text-xs leading-5 text-[var(--text-secondary)]">{agent.description}</p>
                  <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                    {agent.capabilities.map((capability) => (
                      <div key={capability} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        {capability}
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-5">
                    <div>
                      <div className="text-xl font-semibold text-[var(--text-primary)]">{summary?.runs24h ?? 0}</div>
                      <div className="text-[11px] text-[var(--text-tertiary)]">runs · last 24h</div>
                    </div>
                    <div className="max-w-24 text-right text-[11px] leading-4 text-[var(--text-tertiary)]">
                      {formatRelative(summary?.lastActivityAt ?? null)}
                    </div>
                  </div>
                </article>
                {index < AGENT_TEAM.length - 1 && (
                  <div className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] lg:flex">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">Agent activity trail</h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">A live, explainable record of specialist decisions and handoffs.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
          </div>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {loading && !overview ? (
            Array.from({ length: 4 }).map((_, index) => <TimelineSkeleton key={index} />)
          ) : overview?.timeline.length ? (
            overview.timeline.map((item) => {
              const agent = AGENT_TEAM.find((entry) => entry.id === item.agentId)!;
              const Icon = iconByAgent[item.agentId];
              return (
                <div key={item.id} className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5">
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1", accentByAgent[item.agentId])}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm font-medium text-[var(--text-primary)]">{agent.name}</div>
                      <time className="text-xs text-[var(--text-tertiary)]">{formatTimestamp(item.created_at)}</time>
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{item.output_summary ?? humanizeAction(item.action_type)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                      <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5">{humanizeAction(item.action_type)}</span>
                      {item.confidence !== null && <span>{Math.round(item.confidence * 100)}% confidence</span>}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <Bot className="h-9 w-9 text-[var(--text-tertiary)]" />
              <h3 className="mt-3 font-medium text-[var(--text-primary)]">All five agents are ready</h3>
              <p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">Agent decisions will appear here after the next inbound WhatsApp enquiry.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)]/70 px-3 py-3">
      <div className="text-xl font-semibold text-[var(--text-primary)]">{value}</div>
      <div className="text-[11px] text-[var(--text-tertiary)]">{label}</div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex animate-pulse gap-4 px-5 py-4">
      <div className="h-9 w-9 rounded-lg bg-[var(--bg-elevated)]" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-32 rounded bg-[var(--bg-elevated)]" />
        <div className="h-3 w-3/4 rounded bg-[var(--bg-elevated)]" />
      </div>
    </div>
  );
}

function isWorking(timestamp: string | null) {
  return Boolean(timestamp && Date.now() - new Date(timestamp).getTime() < 5 * 60 * 1000);
}

function formatRelative(timestamp: string | null) {
  if (!timestamp) return "Awaiting first run";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return "Active just now";
  if (minutes < 60) return `Last active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last active ${hours}h ago`;
  return `Last active ${Math.floor(hours / 24)}d ago`;
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function humanizeAction(action: string) {
  return action.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
