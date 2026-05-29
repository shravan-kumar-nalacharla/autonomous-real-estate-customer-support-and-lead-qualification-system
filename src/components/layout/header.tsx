"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import {
  Bell,
  LogOut,
  Menu,
  Search,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

const pageTitles: Record<string, string> = {
  "/dashboard": "Analytics",
  "/inbox": "Inbox",
  "/contacts": "Contacts",
  "/pipelines": "Pipeline",
  "/broadcasts": "Broadcasts",
  "/automations": "Automations",
  "/flows": "Flows",
  "/n8n-workflows": "n8n Workflows",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "Analytics";
}

interface HeaderProps {
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const title = getPageTitle(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-[15px] font-medium text-[var(--text-primary)]">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative hidden w-56 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <Input
            placeholder="Search"
            className="h-9 rounded-[var(--radius-md)] border-[var(--border)] bg-[var(--bg-surface)] pl-9 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        <button
          type="button"
          aria-label="Notifications"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Bell className="h-4 w-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-1 transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none data-popup-open:bg-[var(--bg-hover)] sm:gap-3 sm:pl-1 sm:pr-3"
            aria-label="Open account menu"
          >
            <Avatar className="size-8">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                />
              ) : null}
              <AvatarFallback className="bg-[var(--accent-light)] text-sm font-medium text-[var(--accent)]">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium text-[var(--text-primary)] sm:inline">
              {profile?.full_name ?? "User"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-56 border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
          >
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {profile?.full_name ?? "User"}
              </p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">
                {profile?.email ?? ""}
              </p>
            </div>
            <DropdownMenuSeparator className="bg-[var(--border)]" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
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
                  className="focus:bg-[var(--bg-hover)] focus:text-[var(--text-primary)]"
                />
              }
            >
              <SettingsIcon className="size-4" />
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
    </header>
  );
}
