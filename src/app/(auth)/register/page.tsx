import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/account/AuthForms";
import { ErrorNotice } from "@/components/ui/Feedback";
import { db } from "@/server/db";
import { defaultPlanKey, getPlan } from "@/server/services/entitlements";
import { getSettings } from "@/server/settings";
import { formatBytes } from "@/lib/format";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const [settings, users, plan] = await Promise.all([getSettings(), db.user.count(), defaultPlanKey().then(getPlan)]);
  const closed = !settings.registration.enabled && users > 0;
  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 mb-5 text-[13px] text-muted">
        The {plan.name} plan includes {formatBytes(plan.limits.storageBytes, 0)} of storage and files up to {formatBytes(plan.limits.maxFileBytes, 0)}.
        {users === 0 && " The first account becomes the administrator."}
      </p>
      {closed ? (
        <ErrorNotice tone="warning">
          Registration is currently closed.{" "}
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{" "}
          instead.
        </ErrorNotice>
      ) : (
        <RegisterForm next={next} />
      )}
    </div>
  );
}
