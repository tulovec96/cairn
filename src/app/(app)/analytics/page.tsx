import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requirePageUser();
  return (
    <PageContainer wide>
      <PageHeader title="Analytics" description="Where your storage goes and how your files are used. Every number comes from real records." />
      <AnalyticsDashboard />
    </PageContainer>
  );
}
