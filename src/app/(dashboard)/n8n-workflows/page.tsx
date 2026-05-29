"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  TestTube2,
  Trash2,
  Unplug,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_N8N_INSTANCE_URL,
  DEFAULT_SETTINGS,
  DEFAULT_WORKFLOW,
  type N8nEvent,
  type N8nSettingsRecord,
  type N8nWorkflowRecord,
} from "@/lib/n8n-types";

const EVENT_OPTIONS: Array<{ label: string; value: N8nEvent }> = [
  { label: "Message Received", value: "message.received" },
  { label: "Message Sent", value: "message.sent" },
  { label: "Contact Created", value: "contact.created" },
  { label: "Contact Updated", value: "contact.updated" },
  { label: "Deal Created", value: "deal.created" },
  { label: "Deal Stage Changed", value: "deal.stage_changed" },
  { label: "Broadcast Completed", value: "broadcast.completed" },
  { label: "Manual / Custom", value: "manual" },
];

interface WorkflowFormState {
  name: string;
  description: string;
  trigger_event: N8nEvent;
  webhook_url: string;
  secret_token: string;
  is_active: boolean;
}

const DEFAULT_FORM_STATE: WorkflowFormState = {
  name: "",
  description: "",
  trigger_event: "message.received",
  webhook_url: "",
  secret_token: "",
  is_active: true,
};

function truncateWebhook(url: string, max = 50) {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 3)}...`;
}

function formatLastRun(workflow: N8nWorkflowRecord) {
  if (!workflow.last_triggered_at) return "Never run";
  const ago = formatDistanceToNow(new Date(workflow.last_triggered_at), {
    addSuffix: true,
  });
  const status = workflow.last_status_code ? `HTTP ${workflow.last_status_code}` : "Timeout";
  const count = workflow.execution_count ?? 0;
  return `Last run: ${ago} · ${status} · ${count} execution${count === 1 ? "" : "s"}`;
}

function getStatusDotClass(statusCode: number | null) {
  if (!statusCode) return "bg-[var(--text-tertiary)]";
  if (statusCode >= 200 && statusCode < 300) return "bg-[var(--success)]";
  return "bg-[var(--error)]";
}

function isValidUrl(value: string) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.host);
  } catch {
    return false;
  }
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export default function N8nWorkflowsPage() {
  const preseededRef = useRef(false);
  const [workflows, setWorkflows] = useState<N8nWorkflowRecord[]>([]);
  const [settings, setSettings] = useState<N8nSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);
  const [testLoadingId, setTestLoadingId] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showPreloadedBanner, setShowPreloadedBanner] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<N8nWorkflowRecord | null>(null);
  const [formState, setFormState] = useState<WorkflowFormState>(DEFAULT_FORM_STATE);
  const [showSecret, setShowSecret] = useState(false);

  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(DEFAULT_N8N_INSTANCE_URL);

  const activeCount = useMemo(
    () => workflows.filter((workflow) => workflow.is_active).length,
    [workflows],
  );

  const fetchSettings = useCallback(async () => {
    const response = await fetch("/api/n8n/settings", { cache: "no-store" });
    if (!response.ok) return null;
    const json = (await response.json()) as { settings?: N8nSettingsRecord | null };
    return json.settings ?? null;
  }, []);

  const fetchWorkflows = useCallback(async () => {
    const response = await fetch("/api/n8n/workflows", { cache: "no-store" });
    if (!response.ok) return [] as N8nWorkflowRecord[];
    const json = (await response.json()) as { workflows?: N8nWorkflowRecord[] };
    return json.workflows ?? [];
  }, []);

  const initializeData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedSettings, fetchedWorkflows] = await Promise.all([
        fetchSettings(),
        fetchWorkflows(),
      ]);

      let nextSettings = fetchedSettings;
      if (!nextSettings) {
        const createSettingsResponse = await fetch("/api/n8n/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(DEFAULT_SETTINGS),
        });
        if (createSettingsResponse.ok) {
          const json = (await createSettingsResponse.json()) as {
            settings?: N8nSettingsRecord;
          };
          nextSettings = json.settings ?? null;
        }
      }

      if (nextSettings?.instance_url) {
        setUrlDraft(nextSettings.instance_url);
      } else {
        setUrlDraft(DEFAULT_N8N_INSTANCE_URL);
      }

      let nextWorkflows = fetchedWorkflows;
      if (nextWorkflows.length === 0 && !preseededRef.current) {
        preseededRef.current = true;
        const preseedResponse = await fetch("/api/n8n/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(DEFAULT_WORKFLOW),
        });
        if (preseedResponse.ok) {
          const json = (await preseedResponse.json()) as {
            workflow?: N8nWorkflowRecord;
          };
          if (json.workflow) {
            nextWorkflows = [json.workflow];
            setShowPreloadedBanner(true);
          }
        }
      }

      setSettings(nextSettings);
      setWorkflows(nextWorkflows);
    } catch {
      toast.error("Failed to load n8n workflows");
    } finally {
      setLoading(false);
    }
  }, [fetchSettings, fetchWorkflows]);

  useEffect(() => {
    void initializeData();
  }, [initializeData]);

  function openCreateModal() {
    setEditingWorkflow(null);
    setFormState({
      ...DEFAULT_FORM_STATE,
      webhook_url: `${normalizeUrl(urlDraft || DEFAULT_N8N_INSTANCE_URL)}/webhook/`,
    });
    setShowSecret(false);
    setSheetOpen(true);
  }

  function openEditModal(workflow: N8nWorkflowRecord) {
    setEditingWorkflow(workflow);
    setFormState({
      name: workflow.name,
      description: workflow.description ?? "",
      trigger_event: workflow.trigger_event,
      webhook_url: workflow.webhook_url,
      secret_token: workflow.secret_token ?? "",
      is_active: workflow.is_active,
    });
    setShowSecret(false);
    setSheetOpen(true);
  }

  async function saveWorkflow() {
    const trimmedName = formState.name.trim();
    const trimmedWebhook = formState.webhook_url.trim();

    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    if (!isValidUrl(trimmedWebhook)) {
      toast.error("Webhook URL must be valid");
      return;
    }

    setSavingWorkflow(true);
    try {
      const payload = {
        name: trimmedName,
        description: formState.description.trim() || null,
        trigger_event: formState.trigger_event,
        webhook_url: trimmedWebhook,
        secret_token: formState.secret_token.trim() || null,
        is_active: formState.is_active,
        n8n_instance_url: normalizeUrl(urlDraft || DEFAULT_N8N_INSTANCE_URL),
      };

      const response = await fetch(
        editingWorkflow
          ? `/api/n8n/workflows/${editingWorkflow.id}`
          : "/api/n8n/workflows",
        {
          method: editingWorkflow ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(json?.error || "Failed to save workflow");
      }

      const json = (await response.json()) as {
        workflow?: N8nWorkflowRecord;
      };
      const savedWorkflow = json.workflow;
      if (savedWorkflow) {
        setWorkflows((prev) => {
          if (editingWorkflow) {
            return prev.map((workflow) =>
              workflow.id === savedWorkflow.id ? savedWorkflow : workflow,
            );
          }
          return [savedWorkflow, ...prev];
        });
      } else {
        await initializeData();
      }

      setSheetOpen(false);
      toast.success("Workflow saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSavingWorkflow(false);
    }
  }

  async function toggleWorkflow(workflowId: string, nextActive: boolean) {
    const previous = workflows;
    setToggleLoadingId(workflowId);
    setWorkflows((prev) =>
      prev.map((workflow) =>
        workflow.id === workflowId
          ? { ...workflow, is_active: nextActive }
          : workflow,
      ),
    );

    try {
      const response = await fetch(`/api/n8n/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive }),
      });
      if (!response.ok) throw new Error("Failed to update workflow");
      const json = (await response.json()) as { workflow?: N8nWorkflowRecord };
      if (json.workflow) {
        setWorkflows((prev) =>
          prev.map((workflow) =>
            workflow.id === workflowId ? json.workflow! : workflow,
          ),
        );
      }
    } catch {
      setWorkflows(previous);
      toast.error("Failed to update workflow toggle");
    } finally {
      setToggleLoadingId(null);
    }
  }

  async function testWorkflow(workflowId: string) {
    setTestLoadingId(workflowId);
    try {
      const response = await fetch(`/api/n8n/workflows/${workflowId}/test`, {
        method: "POST",
      });
      const json = (await response.json().catch(() => null)) as
        | { success?: boolean; status?: number; message?: string }
        | null;
      const status = json?.status ?? 0;
      const message = json?.message ?? `n8n returned ${status}`;

      setWorkflows((prev) =>
        prev.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                last_triggered_at: new Date().toISOString(),
                last_status_code: status,
                last_error: response.ok ? null : message,
                execution_count: (workflow.execution_count ?? 0) + 1,
              }
            : workflow,
        ),
      );

      if (response.ok) {
        toast.success(`Test successful - ${status} OK`);
      } else {
        toast.error(`n8n returned ${status}`);
      }
    } catch {
      toast.error("Failed to test workflow");
    } finally {
      setTestLoadingId(null);
    }
  }

  async function deleteWorkflow(workflowId: string) {
    const confirmed = window.confirm("Delete this workflow?");
    if (!confirmed) return;

    setDeleteLoadingId(workflowId);
    try {
      const response = await fetch(`/api/n8n/workflows/${workflowId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error();
      setWorkflows((prev) => prev.filter((workflow) => workflow.id !== workflowId));
      toast.success("Workflow deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleteLoadingId(null);
    }
  }

  async function saveInstanceUrl() {
    const normalized = normalizeUrl(urlDraft);
    if (!isValidUrl(normalized)) {
      toast.error("Instance URL must be valid");
      return;
    }

    try {
      const response = await fetch("/api/n8n/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance_url: normalized }),
      });
      if (!response.ok) throw new Error();
      const json = (await response.json()) as { settings?: N8nSettingsRecord };
      setSettings((prev) =>
        json.settings
          ? { ...prev, ...json.settings }
          : ({ ...prev, instance_url: normalized } as N8nSettingsRecord),
      );
      setUrlDraft(normalized);
      setEditingUrl(false);
      toast.success("Instance URL updated");
    } catch {
      toast.error("Failed to update instance URL");
    }
  }

  async function testConnection() {
    setTestingConnection(true);
    try {
      const response = await fetch("/api/n8n/settings/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_url: normalizeUrl(urlDraft || DEFAULT_N8N_INSTANCE_URL),
        }),
      });
      const json = (await response.json().catch(() => null)) as
        | { connected?: boolean; status?: number; instance_url?: string }
        | null;
      const connected = Boolean(json?.connected);
      const status = json?.status ?? 0;
      const nextInstanceUrl = json?.instance_url ?? normalizeUrl(urlDraft);

      setSettings((prev) => ({
        id: prev?.id ?? "temporary",
        instance_url: nextInstanceUrl,
        api_key: prev?.api_key ?? null,
        is_connected: connected,
        last_ping_at: new Date().toISOString(),
        last_ping_status: status,
        created_at: prev?.created_at ?? null,
        updated_at: new Date().toISOString(),
      }));

      if (connected) {
        toast.success(`Connected - ${status}`);
      } else {
        toast.error(`Unreachable - ${status || "timeout"}`);
      }
    } catch {
      toast.error("Connection test failed");
    } finally {
      setTestingConnection(false);
    }
  }

  const connectionBadge = settings?.is_connected ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-light)] px-2 py-1 text-xs font-medium text-[var(--success)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
      Connected
    </span>
  ) : settings?.last_ping_status ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--error-light)] px-2 py-1 text-xs font-medium text-[var(--error)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--error)]" />
      Unreachable
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]" />
      Not tested
    </span>
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--text-primary)]">
            <Zap className="h-5 w-5 text-[var(--n8n-orange)]" />
            n8n Workflows
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Connect your n8n automation instance to Huygen Warp events.
          </p>
        </div>
        <Button onClick={openCreateModal} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Workflow
        </Button>
      </div>

      {showPreloadedBanner ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning-light)] px-3 py-2 text-sm text-[var(--warning)]">
          We pre-loaded your WhatsApp AI Agent workflow. Toggle it on to start
          receiving automation events.
        </div>
      ) : null}

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.04em] text-[var(--text-tertiary)]">
              n8n Connection
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Instance:{" "}
              <span className="font-medium text-[var(--text-primary)]">
                {settings?.instance_url || DEFAULT_N8N_INSTANCE_URL}
              </span>
            </p>
          </div>
          {connectionBadge}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editingUrl ? (
            <>
              <Input
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                className="h-9 max-w-md"
              />
              <Button variant="outline" onClick={saveInstanceUrl}>
                Save URL
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingUrl(false);
                  setUrlDraft(
                    settings?.instance_url || DEFAULT_N8N_INSTANCE_URL,
                  );
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditingUrl(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Change URL
              </Button>
              <Button
                variant="outline"
                onClick={testConnection}
                disabled={testingConnection}
              >
                {testingConnection ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                )}
                Test Connection
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
        <button
          type="button"
          onClick={() => setShowInfo((prev) => !prev)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="text-sm font-medium text-[var(--text-primary)]">
            What is n8n?
          </span>
          {showInfo ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
        </button>
        {showInfo ? (
          <div className="space-y-3 border-t border-[var(--border)] px-5 py-4 text-sm text-[var(--text-secondary)]">
            <p>
              n8n is an open-source automation platform. When events happen in
              Huygen Warp (new message, new contact, deal update), your n8n
              workflows are triggered automatically via webhooks in real time.
            </p>
            <p>How to add a workflow:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>In n8n, create a Webhook node and copy the webhook URL.</li>
              <li>Click Add Workflow above.</li>
              <li>Paste the URL, choose the trigger event, then save.</li>
              <li>Huygen Warp will post event payloads to that webhook.</li>
            </ol>
            <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-primary)]">
{`{
  "event": "message.received",
  "payload": { "customerPhone": "...", "message": "..." },
  "timestamp": "2025-01-01T00:00:00.000Z",
  "source": "huygen-warp"
}`}
            </pre>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">
          Active Workflows ({activeCount})
        </h2>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((row) => (
              <div
                key={row}
                className="animate-pulse rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
              >
                <div className="h-4 w-40 rounded bg-[var(--bg-elevated)]" />
                <div className="mt-3 h-3 w-80 rounded bg-[var(--bg-elevated)]" />
                <div className="mt-4 h-3 w-56 rounded bg-[var(--bg-elevated)]" />
              </div>
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--n8n-light)]">
              <Workflow className="h-5 w-5 text-[var(--n8n-orange)]" />
            </div>
            <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
              No workflows yet.
            </p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Add your first n8n workflow.
            </p>
            <Button onClick={openCreateModal} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" />
              Add Workflow
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {workflows.map((workflow) => {
              const isToggling = toggleLoadingId === workflow.id;
              const isTesting = testLoadingId === workflow.id;
              const isDeleting = deleteLoadingId === workflow.id;

              return (
                <article
                  key={workflow.id}
                  className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-sm)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${workflow.is_active ? "bg-[var(--success)]" : "bg-[var(--text-tertiary)]"}`}
                        />
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {workflow.name}
                        </h3>
                        <span className="rounded-full border border-[var(--n8n-orange)]/45 bg-[var(--n8n-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--n8n-orange)]">
                          {workflow.trigger_event}
                        </span>
                      </div>
                      <a
                        href={workflow.webhook_url}
                        target="_blank"
                        rel="noreferrer"
                        title={workflow.webhook_url}
                        className="mt-2 inline-flex max-w-full items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]"
                      >
                        <span className="truncate">
                          {truncateWebhook(workflow.webhook_url)}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <p className="mt-3 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${getStatusDotClass(workflow.last_status_code)}`}
                        />
                        {formatLastRun(workflow)}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          toggleWorkflow(workflow.id, !workflow.is_active)
                        }
                        disabled={isToggling}
                        aria-label={workflow.is_active ? "Turn off" : "Turn on"}
                        className={`relative inline-flex h-7 w-14 items-center rounded-full px-1 transition ${
                          workflow.is_active
                            ? "bg-[var(--success)]"
                            : "bg-[var(--border-strong)]"
                        } ${isToggling ? "opacity-70" : ""}`}
                      >
                        {isToggling ? (
                          <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin text-white" />
                        ) : (
                          <span
                            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                              workflow.is_active ? "translate-x-7" : "translate-x-0"
                            }`}
                          />
                        )}
                      </button>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => testWorkflow(workflow.id)}
                          disabled={isTesting}
                        >
                          {isTesting ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <TestTube2 className="mr-1 h-3.5 w-3.5" />
                          )}
                          Test
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(workflow)}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteWorkflow(workflow.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text-primary)] sm:max-w-[420px]"
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-[var(--border)] p-5">
              <SheetTitle className="text-[var(--text-primary)]">
                {editingWorkflow ? "Edit Workflow" : "Add Workflow"}
              </SheetTitle>
            </SheetHeader>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="space-y-1.5">
                <label htmlFor="workflow-name">Name</label>
                <Input
                  id="workflow-name"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  placeholder="WhatsApp AI Agent"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="workflow-description">Description</label>
                <Textarea
                  id="workflow-description"
                  rows={2}
                  value={formState.description}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Optional description"
                />
              </div>

              <div className="space-y-1.5">
                <label>Trigger Event</label>
                <Select
                  value={formState.trigger_event}
                  onValueChange={(value) =>
                    setFormState((prev) => ({
                      ...prev,
                      trigger_event: value as N8nEvent,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label} ({option.value})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="workflow-webhook-url">Webhook URL</label>
                <Input
                  id="workflow-webhook-url"
                  value={formState.webhook_url}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      webhook_url: event.target.value,
                    }))
                  }
                  placeholder={`${normalizeUrl(urlDraft || DEFAULT_N8N_INSTANCE_URL)}/webhook/`}
                />
                <p className="text-xs text-[var(--text-tertiary)]">
                  Paste the webhook URL from your n8n Webhook node.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="workflow-secret">Secret Token</label>
                <div className="relative">
                  <Input
                    id="workflow-secret"
                    type={showSecret ? "text" : "password"}
                    value={formState.secret_token}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        secret_token: event.target.value,
                      }))
                    }
                    placeholder="Optional secret token"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    onClick={() => setShowSecret((prev) => !prev)}
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-[var(--text-tertiary)]">
                  If set, a X-Huygen-Signature HMAC header is added.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Active
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Enable this workflow immediately.
                  </p>
                </div>
                <Switch
                  checked={formState.is_active}
                  onCheckedChange={(checked) =>
                    setFormState((prev) => ({ ...prev, is_active: checked }))
                  }
                />
              </div>
            </div>

            <SheetFooter className="flex-row justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <Button
                variant="outline"
                onClick={() => setSheetOpen(false)}
                disabled={savingWorkflow}
              >
                Cancel
              </Button>
              <Button onClick={saveWorkflow} disabled={savingWorkflow}>
                {savingWorkflow ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save Workflow
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

      {!settings?.is_connected && workflows.length > 0 ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <Unplug className="h-3.5 w-3.5" />
          Connection not confirmed yet. Run a connection test before relying on
          workflow triggers.
        </div>
      ) : null}
    </div>
  );
}
