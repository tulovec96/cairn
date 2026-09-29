import type { Metadata } from "next";
import { AdminUserDetail } from "@/components/admin/AdminUserDetail";
import { PageContainer } from "@/components/layout/AppShell";
import { requirePageAdmin } from "@/server/page-auth";

export const metadata: Metadata = { title: "User · Administration" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, admin] = await Promise.all([params, requirePageAdmin()]);
  return (
    <PageContainer wide>
      <AdminUserDetail id={id} selfId={admin.user.id} />
    </PageContainer>
  );
}
