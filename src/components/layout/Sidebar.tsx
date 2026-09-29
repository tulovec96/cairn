"use client";

import { PanelLeftClose, PanelLeftOpen, UploadCloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Drawer } from "@/components/ui/Modal";
import { Tip } from "@/components/ui/Overlays";
import { LogoMark } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { NAV_SECTIONS, isActive } from "./nav";
import { SavedSearchesNav } from "./SavedSearchesNav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export interface SidebarUsage {
  usedBytes: number;
  quotaBytes: number;
  percent: number;
}

function StorageMeter({ usage, collapsed }: { usage: SidebarUsage; collapsed: boolean }) {
  const pct = Math.round(usage.percent);
  const tone = pct >= 90 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-accent";
  const label = `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used`;
  if (collapsed) {
    return (
      <Tip label={label} placement="right">
        <Link href="/dashboard" aria-label={label} className="mx-auto flex size-9 items-center justify-center rounded-md text-[11px] font-semibold text-sidebar-fg hover:bg-sidebar-hover tnum">
          {pct}%
        </Link>
      </Tip>
    );
  }
  return (
    <Link href="/dashboard" className="block rounded-lg border border-sidebar-line px-3 py-2.5 hover:bg-sidebar-hover">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-sidebar-fg">Storage</span>
        <span className="text-sidebar-muted tnum">{pct}%</span>
      </div>
      <div role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-2 h-1.5 overflow-hidden rounded-full bg-sidebar-line">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, Math.min(100, usage.percent))}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-sidebar-muted tnum">{label}</p>
      {pct >= 80 && <p className={cn("mt-1 text-[11px] font-medium", pct >= 90 ? "text-danger" : "text-warning")}>{pct >= 100 ? "Full — free up space to upload." : "Running low on space."}</p>}
    </Link>
  );
}

export function NavList({ isAdmin, collapsed, onNavigate, touch }: { isAdmin: boolean; collapsed: boolean; onNavigate?: () => void; touch?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex-1 space-y-4 overflow-y-auto px-2.5 py-2">
      {NAV_SECTIONS.filter((s) => !s.adminOnly || isAdmin).map((section) => (
        <div key={section.id}>
          {section.label && !collapsed && <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">{section.label}</p>}
          {section.label && collapsed && <div className="mx-2 mb-1 border-t border-sidebar-line" />}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item);
              const link = (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-md font-medium transition-colors",
                    touch ? "h-11 text-sm" : "h-9 text-[13px]",
                    collapsed ? "justify-center" : "px-2.5",
                    active ? "bg-sidebar-active text-white" : "text-sidebar-fg hover:bg-sidebar-hover hover:text-white",
                  )}
                >
                  <item.icon className={cn("size-[17px] shrink-0", active ? "text-accent" : "text-sidebar-muted")} aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tip label={item.label} placement="right">
                      {link}
                    </Tip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!collapsed && <SavedSearchesNav touch={touch} onNavigate={onNavigate} />}
    </nav>
  );
}

interface SidebarProps {
  isAdmin: boolean;
  initialCollapsed: boolean;
  usage: SidebarUsage | null;
}

/** Persistent desktop sidebar. Collapse state is stored in a cookie so the server renders the right width. */
export function Sidebar({ isAdmin, initialCollapsed, usage }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    setCollapsed((c) => {
      document.cookie = `cairn_sidebar=${c ? "0" : "1"}; Path=/; Max-Age=31536000; SameSite=Lax`;
      return !c;
    });
  };
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-line bg-sidebar text-sidebar-fg transition-[width] duration-150 lg:flex",
        collapsed ? "w-[60px]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-4")}>
        <Link href="/dashboard" aria-label="Cairn home" className="inline-flex items-center gap-2 font-semibold tracking-tight text-white">
          <LogoMark className="size-7 text-accent" />
          {!collapsed && <span>Cairn</span>}
        </Link>
      </div>
      <div className={cn("pb-2", collapsed ? "px-2.5" : "px-3")}>
        <div className="mb-2"><WorkspaceSwitcher collapsed={collapsed} /></div>
        {collapsed ? (
          <Tip label="Upload files" placement="right">
            <Link href="/upload" aria-label="Upload files" className="flex h-9 items-center justify-center rounded-md bg-accent text-accent-fg hover:bg-accent-hover">
              <UploadCloud className="size-4" aria-hidden />
            </Link>
          </Tip>
        ) : (
          <Link href="/upload" className="flex h-9 items-center justify-center gap-2 rounded-md bg-accent text-[13px] font-medium text-accent-fg hover:bg-accent-hover">
            <UploadCloud className="size-4" aria-hidden /> Upload
          </Link>
        )}
      </div>
      <NavList isAdmin={isAdmin} collapsed={collapsed} />
      <div className="space-y-2 border-t border-sidebar-line p-2.5">
        {usage && <StorageMeter usage={usage} collapsed={collapsed} />}
        <Tip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} placement="right">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn("flex h-8 w-full items-center gap-2 rounded-md text-xs font-medium text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg", collapsed ? "justify-center" : "px-2.5")}
          >
            {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            {!collapsed && "Collapse"}
          </button>
        </Tip>
      </div>
    </aside>
  );
}

/** The same navigation as a slide-over drawer for phones and tablets. */
export function MobileNav({ isAdmin, usage, open, onOpenChange }: { isAdmin: boolean; usage: SidebarUsage | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Navigation" side="left" width="w-72 max-w-[85vw] bg-sidebar" hideHeader>
      <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
        <div className="flex h-14 shrink-0 items-center px-4">
          <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-white">
            <LogoMark className="size-7 text-accent" /> Cairn
          </span>
        </div>
        <div className="px-3 pb-2">
          <div className="mb-2"><WorkspaceSwitcher /></div>
          <Link href="/upload" onClick={() => onOpenChange(false)} className="flex h-11 items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-accent-fg">
            <UploadCloud className="size-4" aria-hidden /> Upload
          </Link>
        </div>
        <NavList isAdmin={isAdmin} collapsed={false} touch onNavigate={() => onOpenChange(false)} />
        {usage && (
          <div className="border-t border-sidebar-line p-3">
            <StorageMeter usage={usage} collapsed={false} />
          </div>
        )}
      </div>
    </Drawer>
  );
}
