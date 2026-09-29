import {
  Archive,
  BarChart3,
  BookOpen,
  Braces,
  Clock,
  Copy,
  CreditCard,
  FileSearch,
  FolderOpen,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Bell,
  Building2,
  Megaphone,
  Cpu,
  Flag,
  Receipt,
  Layers,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Share2,
  SlidersHorizontal,
  Star,
  Trash2,
  Users,
  Webhook,
  Workflow,
  Activity,
  Ticket,
  DatabaseBackup,
  Mail,
  Biohazard,
  Plug,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only active on the exact path (parents of nested routes). */
  exact?: boolean;
}

export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
  adminOnly?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "main",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/files", label: "Files", icon: FolderOpen },
      { href: "/recent", label: "Recent", icon: Clock },
      { href: "/favorites", label: "Favorites", icon: Star },
      { href: "/shared", label: "Shared links", icon: Share2 },
      { href: "/shared-with-me", label: "Shared with me", icon: Users },
      { href: "/media", label: "Media", icon: ImageIcon },
      { href: "/archive", label: "Archive", icon: Archive },
      { href: "/trash", label: "Trash", icon: Trash2 },
    ],
  },
  {
    id: "collaborate",
    label: "Collaborate",
    items: [
      { href: "/requests", label: "File requests", icon: Inbox },
      { href: "/organizations", label: "Organizations", icon: Building2 },
    ],
  },
  {
    id: "automate",
    label: "Automate",
    items: [
      { href: "/automations", label: "Automations", icon: Workflow },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/import", label: "Import", icon: Plug },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/duplicates", label: "Duplicates", icon: Copy },
    ],
  },
  {
    id: "developers",
    label: "Developers",
    items: [
      { href: "/developer", label: "API usage", icon: Braces, exact: true },
      { href: "/developer/keys", label: "API keys", icon: KeyRound },
      { href: "/developer/docs", label: "API documentation", icon: BookOpen },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, exact: true },
      { href: "/settings/security", label: "Security", icon: ShieldCheck },
      { href: "/settings/billing", label: "Plan & billing", icon: CreditCard },
      { href: "/settings/notifications", label: "Notifications", icon: Bell },
      { href: "/support", label: "Support", icon: LifeBuoy },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    adminOnly: true,
    items: [
      { href: "/admin", label: "Overview", icon: Gauge, exact: true },
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/orgs", label: "Organizations", icon: Building2 },
      { href: "/admin/files", label: "Files", icon: FileSearch },
      { href: "/admin/shares", label: "Shares", icon: Share2 },
      { href: "/admin/quarantine", label: "Malware review", icon: Biohazard },
      { href: "/admin/reports", label: "Abuse reports", icon: ShieldAlert },
      { href: "/admin/plans", label: "Plans", icon: Layers },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: Receipt },
      { href: "/admin/api", label: "API", icon: Braces },
      { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/admin/jobs", label: "Jobs", icon: Cpu },
      { href: "/admin/storage", label: "Storage", icon: HardDrive },
      { href: "/admin/health", label: "Health", icon: Activity },
      { href: "/admin/backups", label: "Backups", icon: DatabaseBackup },
      { href: "/admin/email", label: "Email outbox", icon: Mail },
      { href: "/admin/flags", label: "Feature flags", icon: Flag },
      { href: "/admin/tickets", label: "Support tickets", icon: Ticket },
      { href: "/admin/changelog", label: "Changelog", icon: Megaphone },
      { href: "/admin/incidents", label: "Status incidents", icon: ListChecks },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
      { href: "/admin/settings", label: "System settings", icon: SlidersHorizontal },
    ],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}