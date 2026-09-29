"use client";

import { CreditCard, Gauge, Keyboard, KeyRound, LifeBuoy, LogOut, MonitorSmartphone, Settings, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Feedback";
import { DropdownMenu, type MenuEntry } from "@/components/ui/Menu";
import { api } from "@/lib/api-client";
import { OPEN_SHORTCUTS_EVENT } from "./shortcuts";

interface Props {
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export function UserMenu({ name, email, avatarUrl, isAdmin }: Props) {
  const router = useRouter();
  const go = (href: string) => () => router.push(href);
  const items: MenuEntry[] = [
    { type: "label", label: email },
    { value: "settings", label: "Settings", icon: <Settings />, onSelect: go("/settings") },
    { value: "security", label: "Security", icon: <ShieldCheck />, onSelect: go("/settings/security") },
    { value: "billing", label: "Plan & billing", icon: <CreditCard />, onSelect: go("/settings/billing") },
    { value: "sessions", label: "Sessions", icon: <MonitorSmartphone />, onSelect: go("/settings/sessions") },
    { value: "keys", label: "API keys", icon: <KeyRound />, onSelect: go("/developer/keys") },
    { value: "support", label: "Support", icon: <LifeBuoy />, onSelect: go("/support") },
    { value: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, hint: "?", onSelect: () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)) },
    ...(isAdmin ? ([{ type: "separator" }, { value: "admin", label: "Administration", icon: <Gauge />, onSelect: go("/admin") }] as MenuEntry[]) : []),
    { type: "separator" },
    {
      value: "logout",
      label: "Sign out",
      icon: <LogOut />,
      onSelect: async () => {
        await api("/api/v1/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
        router.replace("/");
        router.refresh();
      },
    },
  ];
  return (
    <DropdownMenu
      items={items}
      trigger={
        <button type="button" aria-label={`Account menu for ${name}`} className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-2">
          <Avatar name={name} src={avatarUrl} />
        </button>
      }
    />
  );
}