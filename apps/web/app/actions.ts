"use server";
import { inngest, db, schema } from "@tether/core";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth0";

export async function decideAction(actionId: string, approved: boolean, note?: string) {
  const user = await currentUser();
  const [action] = await db().select().from(schema.actions).where(eq(schema.actions.id, actionId));
  if (!action || action.status !== "pending") return;
  await inngest.send({ name: "tether/action.decided", data: { actionId, runId: action.runId, approved, note, deciderName: user?.name } });
  revalidatePath("/approvals");
  revalidatePath("/");
}
