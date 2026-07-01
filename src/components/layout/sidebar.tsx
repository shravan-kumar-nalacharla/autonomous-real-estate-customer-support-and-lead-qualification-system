"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  BarChart3,
  Building2,
  CalendarClock,
  GitBranch,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  User,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const mainNavItems: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/appointments", label: "Appointments", icon: CalendarClock },
  { href: "/pipelines", label: "Pipeline", icon: GitBranch },
  { href: "/broadcasts", label: "Broadcasts", icon: Radio },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/dashboard", label: "Analytics", icon: BarChart3 },
];

const automationNavItems: NavItem[] = [
  { href: "/n8n-workflows", label: "n8n Workflows", icon: Zap, badge: "n8n" },
];

const bottomNavItems: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const [n8nConnected, setN8nConnected] = useState(false);
  const [hasActiveWorkflows, setHasActiveWorkflows] = useState(false);

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeydown);
    };
  }, [open, onClose]);

  useEffect(() => {
    let cancelled = false;
    const loadN8nState = async () => {
      try {
        const [settingsRes, workflowsRes] = await Promise.all([
          fetch("/api/n8n/settings", { cache: "no-store" }),
          fetch("/api/n8n/workflows", { cache: "no-store" }),
        ]);
        if (!settingsRes.ok || !workflowsRes.ok || cancelled) return;
        const settingsJson = (await settingsRes.json()) as {
          settings?: { is_connected?: boolean | null };
        };
        const workflowsJson = (await workflowsRes.json()) as {
          workflows?: Array<{ is_active?: boolean | null }>;
        };
        if (cancelled) return;
        const connected = Boolean(settingsJson.settings?.is_connected);
        const hasActive = Boolean(
          workflowsJson.workflows?.some((workflow) => workflow.is_active),
        );
        setN8nConnected(connected);
        setHasActiveWorkflows(hasActive);
      } catch {
        if (!cancelled) {
          setN8nConnected(false);
          setHasActiveWorkflows(false);
        }
      }
    };
    void loadN8nState();
    const interval = window.setInterval(loadN8nState, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const userInitial = useMemo(
    () =>
      profile?.full_name?.charAt(0)?.toUpperCase() ??
      profile?.email?.charAt(0)?.toUpperCase() ??
      "U",
    [profile?.email, profile?.full_name],
  );

  const isActiveRoute = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  const navItemClasses = (active: boolean) =>
    cn(
      "flex w-full items-center gap-3 rounded-[var(--radius-md)] border-l-2 border-transparent px-3 py-2 text-[13px] transition-colors",
      active
        ? "border-[var(--accent)] bg-[var(--bg-active)] font-medium text-[var(--text-primary)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
    );

  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-[rgba(26,23,20,0.28)] backdrop-blur-[1px] transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full w-60 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-4 pt-1">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Huygen Warp"
              width={28}
              height={28}
              className="h-7 w-7 rounded-[8px]"
            />
            <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
              Huygen Warp
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <ul className="flex flex-col gap-1">
            {mainNavItems.map((item) => {
              const active = isActiveRoute(item.href);
              const Icon = item.icon;
              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !active;
              return (
                <li key={item.href}>
                  <Link href={item.href} className={navItemClasses(active)}>
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        active
                          ? "text-[var(--accent)]"
                          : "text-[var(--text-secondary)]",
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {showUnreadDot && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-2 border-t border-[var(--border)]" />

          <ul className="flex flex-col gap-1">
            {automationNavItems.map((item) => {
              const active = isActiveRoute(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={item.href} className={navItemClasses(active)}>
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        active
                          ? "text-[var(--n8n-orange)]"
                          : "text-[var(--text-secondary)]",
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-[var(--n8n-orange)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {item.badge}
                      </span>
                    ) : null}
                    {n8nConnected && hasActiveWorkflows ? (
                      <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[var(--n8n-orange)]" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="my-2 border-t border-[var(--border)]" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const active = isActiveRoute(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link href={item.href} className={navItemClasses(active)}>
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        active
                          ? "text-[var(--accent)]"
                          : "text-[var(--text-secondary)]",
                      )}
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-[var(--border)] p-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none data-popup-open:bg-[var(--bg-hover)]">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-[var(--accent-light)] text-sm font-medium text-[var(--accent)]">
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-xs text-[var(--text-tertiary)]">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]"
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]"
                  />
                }
              >
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuItem
                onClick={signOut}
                className="focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
