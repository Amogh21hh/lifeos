"use client";

import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="bottom-right" toastOptions={{ style: { background: "var(--bg-elev)", color: "var(--text)", border: "1px solid var(--border)" } }} />
    </>
  );
}
