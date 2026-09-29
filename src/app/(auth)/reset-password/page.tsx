import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/account/AuthForms";
import { ErrorNotice } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 mb-5 text-[13px] text-muted">All devices will be signed out when you change it.</p>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <ErrorNotice>
          This link is missing its token. <Link href="/forgot-password" className="font-medium underline">Request a new one</Link>.
        </ErrorNotice>
      )}
    </div>
  );
}