import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInvite } from "@/components/org/AcceptInvite";
import { ErrorNotice } from "@/components/ui/Feedback";
import { ApiError } from "@/server/errors";
import { getPageActor } from "@/server/page-auth";
import { describeInvite } from "@/server/services/organizations";

export const metadata: Metadata = { title: "Organization invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const actor = await getPageActor();
  if (!actor) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  let invite: Awaited<ReturnType<typeof describeInvite>> | null = null;
  let problem: string | null = null;
  try {
    invite = await describeInvite(token);
  } catch (err) {
    problem = err instanceof ApiError ? err.message : "This invitation can't be shown.";
  }
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-lg font-semibold tracking-tight">Organization invitation</h1>
      {invite ? (
        <>
          <p className="mt-2 text-[13px] text-muted">
            You&apos;ve been invited to join <span className="font-medium text-fg">{invite.orgName}</span> as <span className="font-medium text-fg">{invite.role}</span>. The invitation was sent to {invite.email}.
          </p>
          {invite.email.toLowerCase() !== actor.user.email.toLowerCase() ? (
            <ErrorNotice className="mt-4">
              You&apos;re signed in as {actor.user.email}. Invitations only work for the address they were sent to, so sign in with {invite.email} to accept it.
            </ErrorNotice>
          ) : (
            <AcceptInvite token={token} orgName={invite.orgName} />
          )}
        </>
      ) : (
        <ErrorNotice className="mt-4">{problem}</ErrorNotice>
      )}
      <p className="mt-4 text-[13px]">
        <Link href="/dashboard" className="font-medium text-accent hover:underline">Back to Cairn</Link>
      </p>
    </div>
  );
}