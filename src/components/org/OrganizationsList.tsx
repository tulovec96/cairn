"use client";

import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FeatureGate } from "@/components/common/Upgrade";
import { useAccount, useHasFeature } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { pluralize } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { OrgDto } from "@/server/services/organizations";

function CreateOrgDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { organization } = await api<{ organization: OrgDto }>("/api/v1/organizations", { method: "POST", body: { name: name.trim() } });
      toast.success(`Created ${organization.name}`);
      router.push(`/organizations/${organization.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New organization" description="A shared workspace with its own files, members, roles and plan." size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <Field label="Organization name">{(p) => <Input {...p} value={name} minLength={2} maxLength={60} required autoFocus onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={name.trim().length < 2}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function OrganizationsList() {
  const router = useRouter();
  const toast = useToast();
  const { workspace } = useAccount();
  const teams = useHasFeature("teams");
  const res = useResource<{ items: OrgDto[] }>("orgs", (signal) => api<{ items: OrgDto[] }>("/api/v1/organizations", { signal }));
  const [creating, setCreating] = useState(false);
  const items = res.data?.items ?? null;

  const open = async (o: OrgDto) => {
    try {
      await api("/api/v1/workspace", { method: "POST", body: { orgId: o.id } });
      router.push("/files");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't switch workspace", errorMessage(err));
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-muted">Organizations share storage and a plan. Owners and admins manage everything, members add and edit files, viewers can only look and comment.</p>
        {teams && !workspace.orgId && (
          <Button variant="primary" onClick={() => setCreating(true)} icon={<Plus className="size-4" aria-hidden />}>
            New organization
          </Button>
        )}
      </div>
      {!teams && (items?.length ?? 0) === 0 && <FeatureGate feature="teams">{null}</FeatureGate>}
      {res.error && <ErrorNotice className="mb-3">{res.error}</ErrorNotice>}
      {!items && !res.error ? (
        <Skeleton className="h-24" />
      ) : items && items.length === 0 ? (
        teams ? (
          <div className="rounded-lg border border-line bg-surface">
            <EmptyState icon={<Building2 />} title="You're not in any organization" description="Create one to share files with a team, or accept an invitation you received." />
          </div>
        ) : null
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items?.map((o) => (
            <li key={o.id} className="flex flex-col rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Building2 className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">{o.name}</h3>
                  <p className="text-xs text-muted">
                    {pluralize(o.memberCount, "member")} · {o.planName} plan
                  </p>
                </div>
                <Badge tone={o.role === "owner" ? "accent" : "neutral"}>{o.role}</Badge>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant={workspace.orgId === o.id ? "secondary" : "primary"} disabled={workspace.orgId === o.id} onClick={() => open(o)}>
                  {workspace.orgId === o.id ? "Current workspace" : "Open files"}
                </Button>
                <Link href={`/organizations/${o.id}`} className="inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
                  {o.role === "owner" || o.role === "admin" ? "Manage" : "Members"}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateOrgDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
