import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, KeyRound } from "lucide-react";
import { ApiUsagePanel } from "@/components/api/ApiUsagePanel";
import { CodeBlock } from "@/components/api/CodeBlock";
import { formatLimit } from "@/config/entitlements";
import { entitlementsForActor } from "@/server/services/limits";
import { PageContainer } from "@/components/layout/AppShell";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader, PageHeader } from "@/components/ui/Feedback";
import { SCOPE_DOCS } from "@/lib/api-docs";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "API" };

export default async function DeveloperPage() {
  const actor = await requirePageUser();
  const [keys, ent] = await Promise.all([db.apiKey.count({ where: { userId: actor.user.id, revokedAt: null } }), entitlementsForActor(actor)]);
  const base = env.appUrl;
  return (
    <PageContainer>
      <PageHeader
        title="API"
        description="Automate uploads, downloads and sharing over HTTP."
        actions={
          <>
            <ButtonLink href="/developer/docs" icon={<BookOpen className="size-4" aria-hidden />}>
              Documentation
            </ButtonLink>
            <ButtonLink href="/developer/keys" variant="primary" icon={<KeyRound className="size-4" aria-hidden />}>
              {keys ? "Manage keys" : "Create a key"}
            </ButtonLink>
          </>
        }
      />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Quick start" description={`Base URL: ${base}/api/v1`} />
          <div className="space-y-4 p-4">
            <p className="text-[13px] text-muted">
              You have <strong className="font-medium text-fg">{keys}</strong> active API {keys === 1 ? "key" : "keys"}. Create one on the{" "}
              <Link href="/developer/keys" className="font-medium text-accent hover:underline">
                API Keys
              </Link>{" "}
              page, then:
            </p>
            <CodeBlock
              label="Upload a file"
              code={`export CAIRN_KEY=cairn_…

curl -H "Authorization: Bearer $CAIRN_KEY" \\
     -F "file=@photo.jpg" \\
     ${base}/api/v1/files`}
            />
            <CodeBlock
              label="List your files"
              code={`curl -H "Authorization: Bearer $CAIRN_KEY" \\
     "${base}/api/v1/files?sort=created&order=desc&limit=10"`}
            />
            <CodeBlock
              label="Download with resume support"
              code={`curl -L -O -J -C - -H "Authorization: Bearer $CAIRN_KEY" \\
     ${base}/api/v1/files/FILE_ID/download`}
            />
          </div>
        </Card>
        {ent.features.api ? (
          <ApiUsagePanel />
        ) : (
          <Card>
            <CardHeader title="API access" />
            <p className="p-4 text-[13px] text-muted">
              API access isn&apos;t part of the {ent.planName} plan.{" "}
              <Link href="/settings/billing" className="font-medium text-accent hover:underline">
                See what each plan includes
              </Link>
              .
            </p>
          </Card>
        )}
        <Card>
          <CardHeader title="Plan limits" />
          <dl className="divide-y divide-line text-[13px]">
            <div className="grid grid-cols-[12rem_1fr] gap-3 px-4 py-2.5">
              <dt className="text-subtle">Requests per minute</dt>
              <dd className="tnum">{formatLimit("apiRequestsPerMinute", ent.limits.apiRequestsPerMinute)}</dd>
            </div>
            <div className="grid grid-cols-[12rem_1fr] gap-3 px-4 py-2.5">
              <dt className="text-subtle">Active API keys</dt>
              <dd className="tnum">
                {keys} of {formatLimit("apiKeys", ent.limits.apiKeys)}
              </dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Scopes" description="Choose the least a key needs." />
          <dl className="divide-y divide-line">
            {SCOPE_DOCS.map((s) => (
              <div key={s.scope} className="grid gap-1 px-4 py-2.5 text-[13px] sm:grid-cols-[10rem_1fr] sm:gap-4">
                <dt className="font-mono text-xs">{s.scope}</dt>
                <dd className="text-muted">{s.description}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </PageContainer>
  );
}
