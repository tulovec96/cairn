import type { Metadata } from "next";
import { DeleteAccount } from "@/components/account/AccountForms";
import { DataExports } from "@/components/account/DataExports";
import { PageContainer } from "@/components/layout/AppShell";
import { Card, CardHeader, PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Your data" };

export default async function DataPage() {
  const actor = await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Your data" description="Take a copy of everything, or remove your account for good." />
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardHeader title="Export your data" />
          <div className="p-4">
            <DataExports />
          </div>
        </Card>
        <Card>
          <CardHeader title="Delete account" description="Permanently remove your account and everything in it." />
          <div className="p-4">
            <DeleteAccount isAdmin={actor.user.role === "admin"} />
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
