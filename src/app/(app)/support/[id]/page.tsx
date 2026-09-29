import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/AppShell";
import { TicketThread } from "@/components/support/Support";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Support ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  return (
    <PageContainer>
      <Link href="/support" className="text-[13px] text-muted hover:text-fg">
        ← All tickets
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold tracking-tight">Ticket</h1>
      <TicketThread id={id} />
    </PageContainer>
  );
}
