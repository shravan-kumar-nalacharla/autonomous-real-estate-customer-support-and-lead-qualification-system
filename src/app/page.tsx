"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function RootPage() {
  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const error = hash.get("error");

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (!sessionError) {
          window.location.replace("/dashboard");
          return;
        }
      }

      if (error) {
        window.location.replace("/login?error=auth_callback_failed");
        return;
      }

      window.location.replace("/dashboard");
    };

    void run();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-slate-300">Redirecting...</p>
      </div>
    </div>
  );
}
