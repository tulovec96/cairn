"use client";

import { ShieldCheck, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ErrorNotice } from "@/components/ui/Feedback";
import { UploadQueue } from "@/components/upload/UploadQueue";
import { useUploadManager } from "@/components/upload/UploadProvider";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { extensionOf } from "@/lib/fileTypes";
import { formatBytes } from "@/lib/format";
import type { PublicRequestDto } from "@/server/services/fileRequests";

export function RequestPasswordGate({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setState({ loading: true, error: null });
    try {
      await api(`/api/v1/public/requests/${token}/unlock`, { method: "POST", body: { password } });
      router.refresh();
    } catch (err) {
      setState({ loading: false, error: errorMessage(err) });
    }
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{name}</h1>
        <p className="mt-1 text-[13px] text-muted">This upload page is password protected. Enter the password you were given.</p>
      </div>
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
      <Field label="Password">{(p) => <Input {...p} name="password" type="password" autoComplete="off" required autoFocus />}</Field>
      <Button type="submit" variant="primary" full loading={state.loading}>
        Continue
      </Button>
    </form>
  );
}

const STATE_TEXT: Record<Exclude<PublicRequestDto["state"], "open">, string> = {
  closed: "This upload page has been closed by its owner.",
  expired: "This upload page has expired.",
  full: "This upload page has received all the files it can take.",
};

/** The page an outside contributor sees. No account, no session: each upload carries its own key. */
export function RequestPortal({ request }: { request: PublicRequestDto }) {
  const manager = useUploadManager();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [dragging, setDragging] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const accent = request.accent ?? undefined;
  const open = request.state === "open";

  const accept = (files: File[]) => {
    const bad: string[] = [];
    const ok = files.filter((f) => {
      if (request.allowedExtensions.length && !request.allowedExtensions.includes(extensionOf(f.name))) {
        bad.push(`${f.name}: only ${request.allowedExtensions.map((e) => `.${e}`).join(", ")} files are accepted.`);
        return false;
      }
      if (request.maxFileBytes != null && f.size > request.maxFileBytes) {
        bad.push(`${f.name}: files can be at most ${formatBytes(request.maxFileBytes, 0)}.`);
        return false;
      }
      return true;
    });
    setProblems(bad);
    if (ok.length) manager.add(ok, { request: { token: request.token, label: label.trim() || null } });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (open) accept([...e.dataTransfer.files]);
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-sm sm:p-6" style={accent ? { borderTopColor: accent, borderTopWidth: 3 } : undefined}>
        <p className="mb-2 text-xs text-subtle">
          {request.brandName ? <span className="font-medium text-muted">{request.brandName}</span> : <>{request.ownerName} is asking for files</>}
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{request.name}</h1>
        {request.description && <p className="mt-2 text-[13px] whitespace-pre-wrap text-muted">{request.description}</p>}
        {request.welcomeMessage && <p className="mt-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] whitespace-pre-wrap text-muted">{request.welcomeMessage}</p>}
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {request.maxFileBytes != null && <li>Up to {formatBytes(request.maxFileBytes, 0)} per file</li>}
          {request.filesLeft != null && <li>{request.filesLeft} more {request.filesLeft === 1 ? "file" : "files"} accepted</li>}
          {request.allowedExtensions.length > 0 && <li>Accepted types: {request.allowedExtensions.map((e) => `.${e}`).join(", ")}</li>}
        </ul>
      </div>

      {!open ? (
        <ErrorNotice tone="warning">{STATE_TEXT[request.state as keyof typeof STATE_TEXT]}</ErrorNotice>
      ) : (
        <>
          <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <Field label="Your name" optional hint="Shown to the person who asked for the files.">
              {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoComplete="name" />}
            </Field>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn("flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-surface px-6 py-12 text-center transition-colors", dragging ? "border-accent bg-accent-soft" : "border-line-strong")}
          >
            <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <UploadCloud className="size-6" aria-hidden />
            </span>
            <p className="text-base font-semibold">Drop files here</p>
            <p className="mt-1 text-[13px] text-muted">or choose them from your device</p>
            <input
              ref={input}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                accept([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <Button variant="primary" size="lg" className="mt-4" onClick={() => input.current?.click()} icon={<UploadCloud className="size-4" aria-hidden />}>
              Choose files
            </Button>
          </div>
          {problems.length > 0 && (
            <ErrorNotice>
              <ul className="list-disc space-y-0.5 pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </ErrorNotice>
          )}
        </>
      )}
      <UploadQueue requestToken={request.token} />
      <p className="flex items-start gap-2 text-xs text-subtle">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Files are sent in checksummed chunks and checked on arrival. You don&apos;t need an account, and none is created for you.
      </p>
    </div>
  );
}
