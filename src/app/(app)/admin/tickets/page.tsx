import type { Metadata } from "next";
import { AdminTickets } from "@/components/admin/AdminModeration";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";

export const metadata: Metadata = { title: "Support tickets · Administration" };

export default function AdminTicketsPage() {
  return (
    <PageContainer wide>
      <PageHeader title="Support tickets" description="Conversations with your users." />
      <AdminTickets />
    </PageContainer>
  );
}