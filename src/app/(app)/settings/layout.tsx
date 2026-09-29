import type { ReactNode } from "react";
import { SettingsNav } from "@/components/account/SettingsNav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsNav />
      {children}
    </>
  );
}
