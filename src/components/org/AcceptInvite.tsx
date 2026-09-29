"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/Feedback";
import { api, errorMessage } from "@/lib/api-client";

export function AcceptInvite({ token, orgName }: { token: string; orgName: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const accept = async () => {
    setState({ loading: true, error: null });
    try {
      await api(`/api/v1/invites/${token}`, { method: "POST", body: {} });
      router.push("/organizations");
      router.refresh();
    } catch (err) {
      setState({ loading: false, error: errorMessage(err) });
    }
  };
  return (
    <div className="mt-4 space-y-3">
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
      <Button variant="primary" size="lg" full onClick={accept} loading={state.loading}>
        Join {orgName}
      </Button>
    </div>
  );
}