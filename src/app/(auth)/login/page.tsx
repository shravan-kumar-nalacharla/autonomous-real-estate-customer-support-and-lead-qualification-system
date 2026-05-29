import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackError =
    params.error === "auth_callback_failed"
      ? "Authentication link is invalid or expired. Please try again."
      : null;

  return <LoginForm callbackError={callbackError} />;
}
