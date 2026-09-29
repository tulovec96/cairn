"use client";

import { CornerDownLeft, Keyboard, LogOut, Moon, Search, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Kbd } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { api, buildQuery } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import type { FileListResponse } from "@/lib/types";
import type { SavedSearchDto } from "@/server/services/library";
import { NAV_SECTIONS } from "./nav";
import { OPEN_PALETTE_EVENT, OPEN_SHORTCUTS_EVENT, SHORTCUTS } from "./shortcuts";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  group: string;
  run: () => void;
}

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return !!n && (/^(input|textarea|select)$/i.test(n.tagName) || n.isContentEditable);
};

const CHORDS: Record<string, string> = { d: "/dashboard", f: "/files", r: "/recent", s: "/shared", m: "/media", t: "/trash", a: "/analytics" };

/** Ctrl/⌘+K palette plus the global shortcuts (chords like G then F, U for upload, ? for help). */
export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<{ q: string; files: Command[]; saved: SavedSearchDto[] }>({ q: "", files: [], saved: [] });
  const chordAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        openPalette();
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        router.push("/upload");
      } else if (e.key.toLowerCase() === "g") {
        chordAt.current = Date.now();
      } else if (Date.now() - chordAt.current < 1200 && CHORDS[e.key.toLowerCase()]) {
        e.preventDefault();
        chordAt.current = 0;
        router.push(CHORDS[e.key.toLowerCase()]);
      }
    };
    const onOpen = () => openPalette();
    const onHelp = () => setHelpOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onHelp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onHelp);
    };
  }, [openPalette, router]);

  // Results from the server (files + saved searches). Debounced; stale answers are ignored.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const [files, saved] = await Promise.all([
          q ? api<FileListResponse>(`/api/v1/files${buildQuery({ q, limit: 6, scope: "everywhere" })}`, { signal: ctrl.signal }) : Promise.resolve(null),
          api<{ items: SavedSearchDto[] }>("/api/v1/saved-searches", { signal: ctrl.signal }),
        ]);
        setRemote({
          q,
          files: (files?.files ?? []).map<Command>((f) => ({ id: `file-${f.id}`, label: f.name, hint: formatBytes(f.size), icon: <Search className="size-4" />, group: "Files", run: () => router.push(`/file/${f.id}`) })),
          saved: saved.items,
        });
      } catch {
        /* aborted or offline: keep what we have */
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open, router]);

  const go = useCallback(
    (href: string) => () => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const commands = useMemo<Command[]>(() => {
    const nav = NAV_SECTIONS.filter((s) => !s.adminOnly || isAdmin).flatMap((s) => s.items.map<Command>((i) => ({ id: `nav-${i.href}`, label: i.label, icon: <i.icon className="size-4" />, group: s.adminOnly ? "Administration" : "Go to", run: go(i.href) })));
    const actions: Command[] = [
      { id: "act-upload", label: "Upload files", hint: "U", icon: <UploadCloud className="size-4" />, group: "Actions", run: go("/upload") },
      { id: "act-theme", label: "Switch theme (system → light → dark)", icon: <Moon className="size-4" />, group: "Actions", run: () => { setOpen(false); document.querySelector<HTMLButtonElement>("button[aria-label^='Theme:']")?.click(); } },
      { id: "act-help", label: "Keyboard shortcuts", hint: "?", icon: <Keyboard className="size-4" />, group: "Actions", run: () => { setOpen(false); setHelpOpen(true); } },
      {
        id: "act-logout",
        label: "Sign out",
        icon: <LogOut className="size-4" />,
        group: "Actions",
        run: async () => {
          await api("/api/v1/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
          setOpen(false);
          router.replace("/");
          router.refresh();
        },
      },
    ];
    const saved = remote.saved.map<Command>((s) => ({ id: `saved-${s.id}`, label: s.name, hint: s.query, icon: <Search className="size-4" />, group: "Saved searches", run: go(`/files?q=${encodeURIComponent(s.query)}`) }));
    const q = query.trim().toLowerCase();
    const filtered = [...actions, ...nav, ...saved].filter((c) => !q || c.label.toLowerCase().includes(q) || (c.hint ?? "").toLowerCase().includes(q));
    const searchAll: Command[] = query.trim() ? [{ id: "search-all", label: `Search files for “${query.trim()}”`, icon: <Search className="size-4" />, group: "Search", run: go(`/files?q=${encodeURIComponent(query.trim())}`) }] : [];
    return [...searchAll, ...(remote.q === query.trim() ? remote.files : []), ...filtered].slice(0, 40);
  }, [go, isAdmin, query, remote, router]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(commands.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[Math.min(active, commands.length - 1)]?.run();
    }
  };

  let lastGroup = "";
  return (
    <>
      <Modal open={open} onOpenChange={setOpen} title="Command palette" hideTitle size="lg" bodyClassName="p-0 pb-0">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search className="size-4 shrink-0 text-subtle" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={commands[active] ? `pal-${commands[active].id}` : undefined}
            aria-label="Search commands, files and saved searches"
            placeholder="Type a command or search your files…"
            className="h-6 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50dvh] overflow-y-auto p-1.5">
          {commands.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted">Nothing matches “{query}”.</li>}
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">{header}</p>}
                <div
                  id={`pal-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={c.run}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]", i === active ? "bg-accent-soft text-fg" : "text-fg")}
                >
                  <span className="text-subtle">{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="max-w-40 truncate text-[11px] text-subtle">{c.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 text-subtle" aria-hidden />}
                </div>
              </li>
            );
          })}
        </ul>
      </Modal>
      <Modal open={helpOpen} onOpenChange={setHelpOpen} title="Keyboard shortcuts" description="Shortcuts are ignored while you type in a field." size="md">
        {(["Global", "Navigation", "File manager"] as const).map((group) => (
          <section key={group} className="mt-4 first:mt-0">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-subtle uppercase">{group}</h3>
            <dl className="divide-y divide-line rounded-lg border border-line">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <dt>{s.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        {i > 0 && <span className="text-xs text-subtle">{group === "Navigation" ? "then" : "+"}</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </Modal>
    </>
  );
}