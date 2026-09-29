import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { RequestPasswordGate, RequestPortal } from "@/components/request/RequestPortal";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Feedback";
import { LinkOff } from "@/components/share/LinkOff";
import { ApiError } from "@/server/errors";
import { pageRequest } from "@/server/page-auth";
import { describeRequest } from "@/server/services/fileRequests";

export const metadata: Metadata = { title: "Send files", robots: { index: false, follow: false } };

export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let request: Awaited<ReturnType<typeof describeRequest>>;
  try {
    request = await describeRequest(await pageRequest(), token);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 503 || err.status === 403)) {
      return (
        <div className="mx-auto max-w-md">
          <EmptyState
            icon={<LinkOff />}
            title="This upload page doesn't exist"
            description={err.message}
            action={
              <ButtonLink href="/" variant="primary">
                Go to Cairn
              </ButtonLink>
            }
          />
        </div>
      );
    }
    throw err;
  }
  if (request.requiresPassword && !request.unlocked) {
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Lock className="size-5" aria-hidden />
        </div>
        <RequestPasswordGate token={token} name={request.brandName ?? request.name} />
      </div>
    );
  }
  return <RequestPortal request={request} />;
}
