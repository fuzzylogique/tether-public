import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { orgs, users } from "../db/schema.js";
import type { Actor, Notifier, ToolCtx } from "../tools/types.js";
import { maskOrg } from "../workspace.js";
import { refreshRunCard } from "./status.js";

export async function loadOrgByGuild(guildId: string) {
  const [org] = await db().select().from(orgs).where(eq(orgs.guildId, guildId));
  return org;
}

export async function loadActor(orgId: string, discordId?: string, fallbackName?: string): Promise<Actor> {
  if (!discordId) return { roles: ["organizer"], name: fallbackName };
  const [u] = await db().select().from(users).where(and(eq(users.orgId, orgId), eq(users.discordId, discordId)));
  if (u) return { userId: u.id, discordId, name: u.name ?? fallbackName, roles: u.roles };
  return { discordId, name: fallbackName, roles: ["organizer"] };
}

export async function buildToolCtx(input: {
  orgId: string; actor: Actor; runId: string; stepId?: string; agent: string; notify: Notifier;
  attachments?: ToolCtx["attachments"];
}): Promise<ToolCtx> {
  const [org] = await db().select().from(orgs).where(eq(orgs.id, input.orgId));
  if (!org) throw new Error(`org ${input.orgId} not found`);
  const refreshStatus = () => refreshRunCard(input.runId, input.notify).catch((e) => console.warn("status re-render failed", e));
  return { db: db(), org: maskOrg(org), actor: input.actor, runId: input.runId, stepId: input.stepId, agent: input.agent, notify: input.notify, attachments: input.attachments, refreshStatus };
}
