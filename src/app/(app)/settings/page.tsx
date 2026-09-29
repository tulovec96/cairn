import type { Metadata } from "next";
import { AvatarEditor, ProfileSettings } from "@/components/account/ProfileSettings";
import { PageContainer } from "@/components/layout/AppShell";
import { Card, CardHeader, PageHeader } from "@/components/ui/Feedback";
import { formatBytes, formatDateTime } from "@/lib/format";
import { requirePageUser } from "@/server/page-auth";
import { LANGUAGES } from "@/server/services/auth";
import { entitlementsForActor, limitsFor, usageFor } from "@/server/services/limits";
import { serializeUser } from "@/server/services/serializers";

export const metadata: Metadata = { title: "Profile" };

function parse(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export default async function SettingsPage() {
  const actor = await requirePageUser();
  const [limits, usage, ent] = await Promise.all([limitsFor(actor), usageFor(actor), entitlementsForActor(actor)]);
  const user = serializeUser(actor.user);
  const p = parse(actor.user.privacy);
  return (
    <PageContainer>
      <PageHeader title="Profile" description="How you appear to others, and how the app looks for you." />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader title="Photo" />
            <div className="p-4">
              <AvatarEditor user={user} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <div className="p-4">
              <ProfileSettings user={user} languages={[...LANGUAGES]} privacy={{ showEmail: p.showEmail === true, showProfile: p.showProfile !== false }} />
            </div>
          </Card>
        </div>
        <Card className="self-start lg:col-span-2">
          <CardHeader title="Your limits" description={actor.user.role === "admin" ? "Administrator account" : undefined} />
          <dl className="divide-y divide-line text-[13px]">
            {[
              ["Plan", ent.planName],
              ["Storage", `${formatBytes(usage.usedBytes)} of ${limits.quotaBytes < 0 ? "unlimited" : formatBytes(limits.quotaBytes, 0)}`],
              ["Max file size", limits.maxFileBytes < 0 ? "Unlimited" : formatBytes(limits.maxFileBytes, 0)],
              ["Trash kept for", ent.limits.trashRetentionDays < 0 ? "Forever" : `${ent.limits.trashRetentionDays} days`],
              ["Files can be kept forever", limits.allowNever ? "Yes" : `No — up to ${limits.maxRetentionDays} days`],
              ["Member since", formatDateTime(actor.user.createdAt, actor.user.timezone)],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-3 px-4 py-2.5">
                <dt className="text-subtle">{k}</dt>
                <dd className="tnum">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </PageContainer>
  );
}
