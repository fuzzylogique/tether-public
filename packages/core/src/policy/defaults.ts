import type { Effect, Risk } from "../tools/types.js";

export type Decision = { kind: "run" } | { kind: "approve"; approverRole?: string } | { kind: "deny"; reason: string };

/** Baseline when no org policy matches. Loosening these requires an org policy row created by a lead. */
export function defaultDecision(effect: Effect, risk: Risk): Decision {
  if (effect === "read") return { kind: "run" };
  if (effect === "write" && risk === "low") return { kind: "run" };
  if (risk === "high") return { kind: "approve", approverRole: "lead" };
  return { kind: "approve" };
}

export const ROLE_RANK: Record<string, number> = { participant: 0, volunteer: 1, organizer: 2, finance: 3, lead: 4 };

export function hasRole(roles: string[], needed: string) {
  const need = ROLE_RANK[needed] ?? 99;
  return roles.some((r) => (ROLE_RANK[r] ?? -1) >= need);
}
