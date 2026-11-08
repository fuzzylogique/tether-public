import { notFound } from "next/navigation";
import { workspaceSummary } from "@tether/core";
import { currentUser } from "@/lib/auth0";
import { workspaceFor } from "@/lib/data";
import { WorkspaceOverview } from "@/components/workspace-overview";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const ws = user ? await workspaceFor(user, (await params).id) : undefined;
  return { title: ws ? `${ws.org.name} · Tether` : "Tether" };
}

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const ws = user ? await workspaceFor(user, id) : undefined;
  if (!ws) notFound();
  const s = await workspaceSummary(ws.org);
  return <WorkspaceOverview s={s} canEdit={ws.canEdit} />;
}
