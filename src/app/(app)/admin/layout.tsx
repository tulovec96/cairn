import type { ReactNode } from "react";
import { requirePageAdmin } from "@/server/page-auth";

/** Server-side gate for every /admin page. Non-admins get a 404, and every admin API route re-checks the role. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageAdmin();
  return children;
}
