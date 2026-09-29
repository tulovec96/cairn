import type { Metadata } from "next";
import Link from "next/link";
import { AdminTicketThread } from "@/components/admin/AdminModeration";
import { PageContainer } from "@/components/layout/AppShell";

export const metadata: Metadata = { title: "Ticket · Administration" };

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageContainer>
      <Link href="/admin/tickets" className="text-[13px] text-muted hover:text-fg">
        ← All tickets
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold tracking-tight">Support ticket</h1>
      <AdminTicketThread id={id} />
    </PageContainer>
  );
}