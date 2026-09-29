"use client";

import { Bell, CreditCard, Database, Laptop, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/settings", label: "Profile", icon: UserRound },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/settings/sessions", label: "Sessions", icon: Laptop },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/billing", label: "Plan & billing", icon: CreditCard },
  { href: "/settings/data", label: "Your data", icon: Database },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="border-b border-line bg-surface">
      <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors", active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
