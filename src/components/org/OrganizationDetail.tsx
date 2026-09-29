"use client";

import { Mail, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAccount } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input, Select } from "@/components/ui/Field";
import { Avatar, Badge, Card, CardHeader, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatBytes, formatDate, pluralize, timeUntil } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { InviteDto, MemberDto, OrgDto } from "@/server/services/organizations";

interface OrgPayload {
  org: OrgDto;
  members: MemberDto[];
  invites: InviteDto[];
  limits: { members: number };
}

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including billing and deleting the organization.",
  admin: "Manage members, settings and every file.",
  member: "Upload, edit, share and delete files.",
  viewer: "View, download and comment only.",
};

function InviteDialog({ orgId, canInviteAdmin, onClose, onDone }: { orgId: string; canInviteAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ link: string }>(`/api/v1/organizations/${orgId}/invites`, { method: "POST", body: { email: email.trim(), role } });
      setLink(res.link);
      toast.success("Invitation created");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Invite someone" description="The invitation works for 7 days and only for the account that uses this email." size="sm">
      {link ? (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">Invitation created for {email}. If email delivery isn&apos;t set up on this installation, send them this link yourself:</p>
          <p className="rounded-md bg-surface-2 p-2 font-mono text-xs break-all select-all">{link}</p>
          <div className="flex justify-end gap-2">
            <CopyButton value={link} label="Copy link" />
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <Field label="Email address">{(p) => <Input {...p} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Role" hint={ROLE_HELP[role]}>
            {(p) => (
              <Select {...p} value={role} onChange={(e) => setRole(e.target.value)}>
                {canInviteAdmin && <option value="admin">Admin</option>}
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </Select>
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function OrganizationDetail({ orgId }: { orgId: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { workspace } = useAccount();
  const res = useResource<OrgPayload>(`org:${orgId}`, (signal) => api<OrgPayload>(`/api/v1/organizations/${orgId}`, { signal }));
  const overview = useResource<{ files: number; contributors: Array<{ userId: string; name: string; files: number; bytes: number }> } | null>(`org-overview:${orgId}:${workspace.orgId}`, (signal) => (workspace.orgId === orgId ? api<{ files: number; contributors: Array<{ userId: string; name: string; files: number; bytes: number }> }>("/api/v1/organizations/current/overview", { signal }) : Promise.resolve(null)));
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;
  if (!res.data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  const { org, members, invites, limits } = res.data;
  const isOwner = org.role === "owner";
  const canManage = isOwner || org.role === "admin";
  const me = members.find((m) => m.you);

  const run = async (label: string, fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(ok);
      res.reload();
      after?.();
    } catch (err) {
      toast.error(label, errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void run("Couldn't rename", () => api(`/api/v1/organizations/${orgId}`, { method: "PATCH", body: { name: (name ?? org.name).trim() } }), "Renamed", () => {
      setName(null);
      router.refresh();
    });
  };

  const changeRole = (m: MemberDto, role: string) => run("Couldn't change the role", () => api(`/api/v1/organizations/${orgId}/members/${m.id}`, { method: "PATCH", body: { role } }), `${m.name} is now ${role}`);

  const remove = async (m: MemberDto) => {
    const self = m.you;
    if (!(await confirm({ title: self ? `Leave ${org.name}?` : `Remove ${m.name}?`, description: self ? "You'll lose access to the organization's files." : "They lose access immediately. Files they added stay in the organization.", confirmLabel: self ? "Leave" : "Remove", tone: "danger" }))) return;
    await run("Couldn't remove the member", () => api(`/api/v1/organizations/${orgId}/members/${m.id}`, { method: "DELETE" }), self ? "You left the organization" : "Member removed", () => {
      if (self) {
        router.push("/organizations");
        router.refresh();
      }
    });
  };

  const transfer = async (m: MemberDto) => {
    if (!(await confirm({ title: `Make ${m.name} the owner?`, description: "You become an admin. Only the owner can manage billing or delete the organization.", confirmLabel: "Transfer ownership", tone: "danger" }))) return;
    await run("Couldn't transfer ownership", () => api(`/api/v1/organizations/${orgId}/transfer`, { method: "POST", body: { userId: m.userId } }), "Ownership transferred", () => router.refresh());
  };

  const revoke = (i: InviteDto) => run("Couldn't revoke", () => api(`/api/v1/organizations/${orgId}/invites?inviteId=${encodeURIComponent(i.id)}`, { method: "DELETE" }), "Invitation revoked");

  const destroy = async () => {
    if (!(await confirm({ title: "Delete this organization?", description: "Every file, folder, share link and request in it is permanently deleted.", confirmLabel: "Delete everything", tone: "danger" }))) return;
    setBusy(true);
    try {
      await api(`/api/v1/organizations/${orgId}`, { method: "DELETE", body: { confirm: deleteName } });
      toast.success("Organization deleted");
      router.push("/organizations");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const seats = limits.members < 0 ? `${members.length} members` : `${members.length} of ${limits.members} seats`;

  return (
    <div className="space-y-4">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Card>
        <CardHeader
          title="Members"
          description={`${seats}${invites.length ? ` · ${pluralize(invites.length, "pending invitation")}` : ""}`}
          actions={
            canManage && (
              <Button variant="primary" size="sm" onClick={() => setInviting(true)} icon={<UserPlus className="size-4" aria-hidden />}>
                Invite
              </Button>
            )
          }
        />
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={m.name} src={m.avatarUrl} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {m.name} {m.you && <span className="font-normal text-subtle">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted">{m.email || "Email hidden"} · joined {formatDate(m.joinedAt)}</p>
              </div>
              {canManage && m.role !== "owner" && !m.you && (org.role === "owner" || m.role !== "admin") ? (
                <>
                  <label className="sr-only" htmlFor={`role-${m.id}`}>
                    Role for {m.name}
                  </label>
                  <Select id={`role-${m.id}`} value={m.role} disabled={busy} onChange={(e) => void changeRole(m, e.target.value)} className="h-8 w-28 text-[13px]">
                    {isOwner && <option value="admin">Admin</option>}
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                </>
              ) : (
                <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role}</Badge>
              )}
              {isOwner && !m.you && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => transfer(m)}>
                  Make owner
                </Button>
              )}
              {((canManage && m.role !== "owner" && !m.you && (isOwner || m.role !== "admin")) || (m.you && m.role !== "owner")) && (
                <Button size="icon-sm" variant="ghost" aria-label={m.you ? "Leave organization" : `Remove ${m.name}`} disabled={busy} onClick={() => remove(m)}>
                  <UserMinus className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {canManage && invites.length > 0 && (
        <Card>
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <Mail className="size-4 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <Badge>{i.role}</Badge>
                <span className="text-xs text-subtle">expires {timeUntil(i.expiresAt)}</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => revoke(i)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {overview.data && overview.data.contributors.length > 0 && (
        <Card>
          <CardHeader title="Who's using the space" description={`${pluralize(overview.data.files, "file")} in total`} />
          <ul className="divide-y divide-line">
            {overview.data.contributors.map((c) => (
              <li key={c.userId} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-muted tnum">{pluralize(c.files, "file")}</span>
                <span className="w-20 text-right font-medium tnum">{formatBytes(c.bytes)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader title="Settings" description={`${org.planName} plan · manage it under Plan & billing while this workspace is open.`} />
          <form onSubmit={rename} className="flex flex-wrap items-end gap-3 p-4">
            <Field label="Organization name" className="min-w-56 flex-1">
              {(p) => <Input {...p} value={name ?? org.name} minLength={2} maxLength={60} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" loading={busy} disabled={name === null || name.trim() === org.name || name.trim().length < 2}>
              Rename
            </Button>
          </form>
        </Card>
      )}

      {isOwner && (
        <Card>
          <CardHeader title="Delete organization" description="Permanently removes the organization and everything in it." />
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Field label={`Type “${org.name}” to confirm`} className="min-w-56 flex-1">
              {(p) => <Input {...p} value={deleteName} autoComplete="off" onChange={(e) => setDeleteName(e.target.value)} />}
            </Field>
            <Button variant="danger" onClick={destroy} loading={busy} disabled={deleteName !== org.name} icon={<Trash2 className="size-4" aria-hidden />}>
              Delete organization
            </Button>
          </div>
        </Card>
      )}
      {!me && <ErrorNotice tone="warning">You&apos;re not a member of this organization.</ErrorNotice>}
      {inviting && <InviteDialog orgId={orgId} canInviteAdmin={isOwner} onClose={() => setInviting(false)} onDone={res.reload} />}
    </div>
  );
}
