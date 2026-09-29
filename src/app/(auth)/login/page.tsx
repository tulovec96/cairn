import type { Metadata } from "next";
import { LoginForm } from "@/components/account/AuthForms";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const settings = await getSettings();
  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 mb-5 text-[13px] text-muted">Welcome back.</p>
      <LoginForm next={next} registrationEnabled={settings.registration.enabled} />
    </div>
  );
}
