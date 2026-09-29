import type { Metadata } from "next";
import Link from "next/link";
import { VerifyEmailStatus } from "@/components/account/AuthForms";
import { ErrorNotice } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Confirm your email</h1>
      {token ? <VerifyEmailStatus token={token} /> : <ErrorNotice>This link is missing its token.</ErrorNotice>}
      <p className="mt-4 text-[13px]">
        <Link href="/dashboard" className="font-medium text-accent hover:underline">Continue to Cairn</Link>
      </p>
    </div>
  );
}