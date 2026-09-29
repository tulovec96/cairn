"use client";

import { Building2, Check, ChevronsUpDown, Plus, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { DropdownMenu, type MenuEntry } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useAccount } from "./AccountContext";

/** Switches between personal files and organizations. Membership is re-verified by the server on every request. */
export function WorkspaceSwitcher({ collapsed, dark = true }: { collapsed?: boolean; dark?: boolean }) {
  const { workspace, orgs, user } = useAccount();
  const router = useRouter();
  const toast = useToast();

  const choose = async (orgId: string | null) => {
    if (orgId === workspace.orgId) return;
    try {
      await api("/api/v1/workspace", { method: "POST", body: { orgId } });
      router.push("/files");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't switch workspace", errorMessage(err));
    }
  };

  const items: MenuEntry[] = [
    { type: "label", label: "Workspace" },
    { value: "personal", label: "Personal files", icon: workspace.orgId ? <User /> : <Check />, onSelect: () => void choose(null) },
    ...orgs.map<MenuEntry>((o) => ({ value: o.id, label: o.name, hint: o.role, icon: workspace.orgId === o.id ? <Check /> : <Building2 />, onSelect: () => void choose(o.id) })),
    { type: "separator" },
    { value: "manage", label: orgs.length ? "Manage organizations" : "Create an organization", icon: <Plus />, onSelect: () => router.push("/organizations") },
  ];
  const label = workspace.name ?? "Personal";
  return (
    <DropdownMenu
      placement="bottom-start"
      items={items}
      trigger={
        <button
          type="button"
          aria-label={`Workspace: ${label}. Switch workspace.`}
          className={cn(
            "flex w-full items-center gap-2 rounded-md text-left text-[13px] font-medium transition-colors",
            dark ? "text-sidebar-fg hover:bg-sidebar-hover" : "text-fg hover:bg-surface-2",
            collapsed ? "size-9 justify-center" : "h-9 px-2.5",
          )}
        >
          {workspace.orgId ? <Building2 className="size-4 shrink-0 text-accent" aria-hidden /> : <User className="size-4 shrink-0 text-accent" aria-hidden />}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{workspace.orgId ? label : user.displayName}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
            </>
          )}
        </button>
      }
    />
  );
}