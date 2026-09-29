"use client";

import { CornerDownRight, Pencil, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { UpgradeNotice } from "@/components/common/Upgrade";
import { useAccount } from "@/components/layout/AccountContext";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Avatar, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { CommentDto } from "@/server/services/comments";

function Composer({ placeholder, onSubmit, initial = "", submitLabel = "Comment", onCancel }: { placeholder: string; onSubmit: (body: string) => Promise<void>; initial?: string; submitLabel?: string; onCancel?: () => void }) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setBody("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <Textarea
        aria-label={placeholder}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex justify-end gap-1.5">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={submit} loading={busy} disabled={!body.trim()} icon={<Send className="size-3.5" aria-hidden />}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** Threaded comments on a file. @handle mentions notify workspace members. */
export function CommentsTab({ fileId }: { fileId: string }) {
  const { plan } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();
  const enabled = plan.features.comments;
  const res = useResource<{ items: CommentDto[] }>(`comments-${fileId}`, (signal) => (enabled ? api(`/api/v1/files/${fileId}/comments`, { signal }) : Promise.resolve({ items: [] })));
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (!enabled) return <UpgradeNotice feature="comments" />;
  if (res.error) return <ErrorNotice>{res.error}</ErrorNotice>;

  const post = async (body: string, parentId?: string) => {
    try {
      await api(`/api/v1/files/${fileId}/comments`, { method: "POST", body: { body, ...(parentId ? { parentId } : {}) } });
      setReplyTo(null);
      res.reload();
    } catch (err) {
      toast.error("Couldn't post", errorMessage(err));
      throw err;
    }
  };
  const edit = async (id: string, body: string) => {
    try {
      await api(`/api/v1/comments/${id}`, { method: "PATCH", body: { body } });
      setEditing(null);
      res.reload();
    } catch (err) {
      toast.error("Couldn't save", errorMessage(err));
      throw err;
    }
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: "Delete this comment?", confirmLabel: "Delete", tone: "danger" }))) return;
    try {
      await api(`/api/v1/comments/${id}`, { method: "DELETE" });
      res.reload();
    } catch (err) {
      toast.error("Couldn't delete", errorMessage(err));
    }
  };

  const items = res.data?.items ?? [];
  const roots = items.filter((c) => !c.parentId);
  const render = (c: CommentDto, depth: number) => (
    <li key={c.id} className={depth ? "ml-6 border-l border-line pl-3" : undefined}>
      <div className="flex gap-2.5 py-2">
        <Avatar name={c.author?.name ?? "?"} className="size-7 text-[10px]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-subtle">
            <span className="font-medium text-fg">{c.deleted ? "Deleted comment" : c.author?.name}</span> · {timeAgo(c.createdAt)}
            {c.edited && !c.deleted ? " · edited" : ""}
          </p>
          {editing === c.id ? (
            <Composer placeholder="Edit your comment" initial={c.body} submitLabel="Save" onSubmit={(b) => edit(c.id, b)} onCancel={() => setEditing(null)} />
          ) : c.deleted ? (
            <p className="text-[13px] text-subtle italic">This comment was removed.</p>
          ) : (
            <p className="text-[13px] break-words whitespace-pre-wrap">{c.body}</p>
          )}
          {!c.deleted && editing !== c.id && (
            <div className="mt-1 flex gap-1 text-xs">
              {depth === 0 && (
                <button type="button" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-fg">
                  <CornerDownRight className="size-3" aria-hidden /> Reply
                </button>
              )}
              {c.mine && (
                <>
                  <button type="button" onClick={() => setEditing(c.id)} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-fg">
                    <Pencil className="size-3" aria-hidden /> Edit
                  </button>
                  <button type="button" onClick={() => void remove(c.id)} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted hover:bg-surface-2 hover:text-danger">
                    <Trash2 className="size-3" aria-hidden /> Delete
                  </button>
                </>
              )}
            </div>
          )}
          {replyTo === c.id && (
            <div className="mt-2">
              <Composer placeholder="Write a reply" submitLabel="Reply" onSubmit={(b) => post(b, c.id)} onCancel={() => setReplyTo(null)} />
            </div>
          )}
        </div>
      </div>
      {items.filter((r) => r.parentId === c.id).length > 0 && <ul>{items.filter((r) => r.parentId === c.id).map((r) => render(r, depth + 1))}</ul>}
    </li>
  );

  return (
    <div className="space-y-3">
      {!res.data ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : roots.length === 0 ? (
        <p className="text-[13px] text-muted">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="divide-y divide-line">{roots.map((c) => render(c, 0))}</ul>
      )}
      <Composer placeholder="Add a comment (use @name to mention someone)" onSubmit={(b) => post(b)} />
      <p className="text-[11px] text-subtle">Ctrl+Enter to send.</p>
    </div>
  );
}
