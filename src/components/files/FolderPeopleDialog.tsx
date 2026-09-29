"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Avatar, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { FolderMemberDto } from "@/server/services/sharedFolders";

/** Share a folder with other accounts, view-only. Separate from public links: these people must sign in. */
export function FolderPeopleDialog({ folderId, name, onClose }: { folderId: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const res = useResource<{ items: FolderMemberDto[] }>(`folder-members:${folderId}`, (signal) => api<{ items: FolderMemberDto[] }>(`/api/v1/folders/${folderId}/members`, { signal }));
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const out = await api<{ items: FolderMemberDto[]; note: string }>(`/api/v1/folders/${folderId}/members`, { method: "POST", body: { email: email.trim() } });
      res.mutate({ items: out.items });
      setNote(out.note);
      setEmail("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: FolderMemberDto) => {
    try {
      await api(`/api/v1/folders/${folderId}/members/${m.id}`, { method: "DELETE" });
      toast.success(`${m.name} no longer has access`);
      res.reload();
    } catch (err) {
      toast.error("Couldn't remove access", errorMessage(err));
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Share with people" description={`“${name}” and everything inside it. They can view and download, and can't change anything.`} size="md">
      <form onSubmit={add} className="flex items-end gap-2">
        <Field label="Email of an account" className="flex-1">{(p) => <Input {...p} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()} icon={<UserPlus className="size-4" aria-hidden />}>
          Add
        </Button>
      </form>
      {error && <ErrorNotice className="mt-3">{error}</ErrorNotice>}
      {note && <p className="mt-3 text-[13px] text-muted" role="status">{note}</p>}
      <h3 className="mt-5 mb-2 text-[13px] font-semibold">People with access</h3>
      {res.error ? (
        <ErrorNotice>{res.error}</ErrorNotice>
      ) : !res.data ? (
        <Skeleton className="h-12" />
      ) : res.data.items.length === 0 ? (
        <p className="text-[13px] text-muted">Only you, so far.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {res.data.items.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={m.name} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{m.name}</p>
                <p className="truncate text-xs text-muted">
                  {m.email} · since {formatDate(m.addedAt)}
                </p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => remove(m)}>
                <UserMinus className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
