import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/account/AuthForms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 mb-5 text-[13px] text-muted">Enter your account email. We&apos;ll send a link that works once, for one hour.</p>
      <ForgotPasswordForm />
    </div>
  );
}