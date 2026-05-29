"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "recovery",
  "invite",
  "email",
  "email_change",
]);

function getSafeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }

  return next;
}

export default function AuthCallbackPage() {
  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const nextPath = getSafeNextPath(url.searchParams.get("next"));

      try {
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") as EmailOtpType | null;

        let authError: string | null = null;

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          authError = error?.message ?? null;
        } else if (tokenHash && type && ALLOWED_OTP_TYPES.has(type)) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          authError = error?.message ?? null;
        } else {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            authError = error?.message ?? null;
          } else {
            const {
              data: { session },
              error,
            } = await supabase.auth.getSession();
            if (!session) {
              authError = error?.message ?? "No session found in callback URL";
            }
          }
        }

        if (authError) {
          window.location.replace("/login?error=auth_callback_failed");
          return;
        }

        window.location.replace(nextPath);
      } catch {
        window.location.replace("/login?error=auth_callback_failed");
      }
    };

    void run();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-slate-300">Completing sign-in...</p>
      </div>
    </div>
  );
}