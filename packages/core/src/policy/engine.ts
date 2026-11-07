import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { policies } from "../db/schema.js";
import type { Actor, Tool } from "../tools/types.js";
import { defaultDecision, hasRole, type Decision } from "./defaults.js";

type Condition = { field?: string; op?: "lt" | "lte" | "gt" | "gte" | "eq" | "in"; value?: unknown; roles?: string[] };

function matches(cond: Condition, args: Record<string, unknown>, actor: Actor): boolean {
  if (cond.roles?.length && !cond.roles.some((r) => hasRole(actor.roles, r))) return false;
  if (!cond.field) return true;
  const v = args[cond.field];
  const t = cond.value;
  switch (cond.op) {
    case "lt": return typeof v === "number" && typeof t === "number" && v < t;
    case "lte": return typeof v === "number" && typeof t === "number" && v <= t;
    case "gt": return typeof v === "number" && typeof t === "number" && v > t;
    case "gte": return typeof v === "number" && typeof t === "number" && v >= t;
    case "eq": return v === t;
    case "in": return Array.isArray(t) && t.includes(v as never);
    default: return true;
  }
}

/**
 * The gateway. Invariants that no policy row can override:
 *  - external+high always needs a lead unless an org policy explicitly says "run" AND the actor is a lead.
 *  - "deny" rows always win.
 */
export async function decide(input: {
  db: Db; orgId: string; tool: Tool; args: Record<string, unknown>; actor: Actor;
}): Promise<Decision> {
  const rows = await input.db.select().from(policies).where(eq(policies.orgId, input.orgId));
  const applicable = rows
    .filter((p) => p.tool === "*" || p.tool === input.tool.name)
    .sort((a, b) => a.priority - b.priority)
    .filter((p) => matches((p.condition ?? {}) as Condition, input.args, input.actor));

  if (applicable.some((p) => p.decision === "deny")) return { kind: "deny", reason: "denied by org policy" };

  const first = applicable[0];
  const base = defaultDecision(input.tool.effect, input.tool.risk);
  if (!first) return base;

  if (first.decision === "run") {
    // Invariant: high-risk external actions can only be auto-run by a lead.
    if (input.tool.risk === "high" && input.tool.effect === "external" && !hasRole(input.actor.roles, "lead")) {
      return { kind: "approve", approverRole: "lead" };
    }
    return { kind: "run" };
  }
  if (first.decision === "approve") return { kind: "approve", approverRole: base.kind === "approve" ? base.approverRole : undefined };
  return base;
}
