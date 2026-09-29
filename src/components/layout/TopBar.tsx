"use client";

import { Command, Menu as MenuIcon, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Feedback";
import { NotificationsBell } from "./NotificationsBell";
import { OPEN_PALETTE_EVENT } from "./shortcuts";
import { MobileNav, type SidebarUsage } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

const SEARCHABLE = ["/files", "/favorites", "/shared", "/recent"];

interface Props {
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  usage: SidebarUsage | null;
}

export function TopBar({ name, email, avatarUrl, isAdmin, usage }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  // Keep the box in sync when the URL changes (e.g. "clear filters" inside the file manager).
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  if (urlQuery !== syncedUrlQuery) {
    setSyncedUrlQuery(urlQuery);
    setQuery(urlQuery);
  }

  // "/" focuses search (Ctrl/⌘+K opens the command palette instead). Ignored while typing in a field so it never hijacks input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const base = SEARCHABLE.includes(pathname) ? pathname : "/files";
    const q = query.trim();
    router.push(q ? `${base}?q=${encodeURIComponent(q)}` : base);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation menu" onClick={() => setNavOpen(true)}>
        <MenuIcon className="size-5" aria-hidden />
      </Button>
      <MobileNav isAdmin={isAdmin} usage={usage} open={navOpen} onOpenChange={setNavOpen} />
      <form role="search" onSubmit={submit} className="relative min-w-0 max-w-md flex-1">
        <label htmlFor="global-search" className="sr-only">
          Search files
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          id="global-search"
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          autoComplete="off"
          className="h-9 w-full rounded-md border border-line bg-surface-2 pr-14 pl-9 text-sm text-fg placeholder:text-subtle transition-colors hover:border-line-strong focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/25 focus:outline-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:block">
          <Kbd>/</Kbd>
        </span>
      </form>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Open command palette" onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}>
          <Command className="size-4" aria-hidden />
        </Button>
        <ThemeToggle />
        <NotificationsBell />
        <UserMenu name={name} email={email} avatarUrl={avatarUrl} isAdmin={isAdmin} />
      </div>
    </header>
  );
}
