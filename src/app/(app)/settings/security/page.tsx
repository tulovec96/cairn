import type { Metadata } from "next";
import { PasswordForm } from "@/components/account/AccountForms";
import { EmailChangeForm, LoginHistory, TwoFactorPanel } from "@/components/account/SecuritySettings";
import { PageContainer } from "@/components/layout/AppShell";
import { Card, CardHeader, PageHeader } from "@/components/ui/Feedback";
import { requirePageUser } from "@/server/page-auth";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const actor = await requirePageUser();
  return (
    <PageContainer>
      <PageHeader title="Security" description="Sign-in protection and a record of what happened on your account." />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Two-factor authentication" description="A code from your phone on top of your password." />
            <div className="p-4">
              <TwoFactorPanel enabled={!!actor.user.totpEnabledAt} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Change password" description="Changing it signs out every other browser." />
            <div className="p-4">
              <PasswordForm />
            </div>
          </Card>
          <Card>
            <CardHeader title="Email address" />
            <div className="p-4">
              <EmailChangeForm email={actor.user.email} verified={!!actor.user.emailVerifiedAt} />
            </div>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Recent security activity" description="Sign-ins and security changes. If something looks wrong, change your password." />
          <LoginHistory />
        </Card>
      </div>
    </PageContainer>
  );
}
