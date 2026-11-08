import { notFound } from "next/navigation";
import { workspaceSummary } from "@tether/core";
import { publicWorkspace } from "@/lib/data";
import { WorkspaceOverview } from "@/components/workspace-overview";

/**
 * Public, read-only overview. No sign-in: the middleware leaves `/demo` open. The workspace id is an unguessable
 * UUID, so this is a share-by-link page (judges, sponsors, the parent club), the way an unlisted doc works.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const org = await publicWorkspace((await params).id);
  return { title: org ? `${org.name} · Tether` : "Tether" };
}

export default async function PublicWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const org = await publicWorkspace((await params).id);
  if (!org) notFound();
  const s = await workspaceSummary(org);
  return <WorkspaceOverview s={s} canEdit={false} publicView />;
}
