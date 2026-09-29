"use client";

import type { ReactNode } from "react";
import { UploadDock } from "@/components/upload/UploadDock";
import { UploadProvider } from "@/components/upload/UploadProvider";
import { ConfirmProvider } from "@/components/ui/Confirm";
import { ToastProvider } from "@/components/ui/Toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <UploadProvider>
          {children}
          <UploadDock />
        </UploadProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
