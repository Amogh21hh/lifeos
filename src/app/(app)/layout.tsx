import { AppShell } from "@/components/shell/app-shell";
import { aiStatus } from "@/server/ai/llm";
import { getPendingApprovals, getViewer } from "@/server/services/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user } = await getViewer();
  const pending = await getPendingApprovals();
  const ai = aiStatus();
  return (
    <AppShell user={{ name: user.name, email: user.email, isDemo: user.isDemo }} pendingApprovals={pending} aiEngine={ai.available ? `${ai.engine} · ${ai.model}` : "local"}>
      {children}
    </AppShell>
  );
}
