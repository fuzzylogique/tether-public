"use server";
import { db, integrationKeys, schema, setIntegration, type IntegrationKey } from "@tether/core";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth0";
import { workspaceFor } from "@/lib/data";

export async function toggleIntegration(orgId: string, key: IntegrationKey, enabled: boolean) {
  const user = await currentUser();
  if (!user) return { error: "Sign in again." };
  if (!integrationKeys.includes(key)) return { error: "Unknown integration." };
  const ws = await workspaceFor(user, orgId);
  if (!ws?.canEdit) return { error: "Only organizers can change integrations." };
  await setIntegration(orgId, key, enabled);
  await db().insert(schema.events).values({ orgId, kind: "integration_changed", data: { integration: key, enabled, by: user.email || user.name, via: "web" } });
  revalidatePath(`/w/${orgId}`);
  revalidatePath("/");
}
