import { z } from "zod";
import { generateStructured } from "./gemini.js";
import { env } from "../env.js";
import { agents } from "../agents/registry.js";
import type { Plan, PlanStep } from "../db/schema.js";

export const planSchema = z.object({
  summary: z.string().max(200),
  steps: z.array(z.object({
    id: z.string().regex(/^s[1-9]$/),
    agent: z.string(),
    instruction: z.string().max(400),
    dependsOn: z.array(z.string()).default([]),
    needsApproval: z.boolean().default(false),
  })).min(1).max(6),
});

export type PlanDraft = z.infer<typeof planSchema>;

export function validatePlan(p: PlanDraft): string[] {
  const errors: string[] = [];
  const known = new Set(Object.keys(agents()));
  const ids = new Set(p.steps.map((s) => s.id));
  if (ids.size !== p.steps.length) errors.push("duplicate step ids");
  for (const s of p.steps) {
    if (!known.has(s.agent)) errors.push(`unknown agent "${s.agent}" in ${s.id}; valid: ${[...known].join(", ")}`);
    for (const d of s.dependsOn) {
      if (!ids.has(d)) errors.push(`${s.id} depends on missing ${d}`);
      if (d === s.id) errors.push(`${s.id} depends on itself`);
    }
  }
  // cycle check
  const visiting = new Set<string>(), done = new Set<string>();
  const byId = new Map(p.steps.map((s) => [s.id, s]));
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const d of byId.get(id)?.dependsOn ?? []) if (!visit(d)) return false;
    visiting.delete(id); done.add(id);
    return true;
  };
  for (const s of p.steps) if (!visit(s.id)) { errors.push("cycle detected"); break; }
  return errors;
}

export function toPlan(draft: PlanDraft): Plan {
  return { summary: draft.summary, steps: draft.steps.map((s): PlanStep => ({ ...s, enabled: true })) };
}

/** Topological levels; steps in the same level run in parallel. */
export function levels(plan: Plan): PlanStep[][] {
  const enabled = plan.steps.filter((s) => s.enabled);
  const enabledIds = new Set(enabled.map((s) => s.id));
  const remaining = new Map(enabled.map((s) => [s.id, new Set(s.dependsOn.filter((d) => enabledIds.has(d)))]));
  const out: PlanStep[][] = [];
  while (remaining.size) {
    const ready = enabled.filter((s) => remaining.has(s.id) && remaining.get(s.id)!.size === 0);
    if (!ready.length) throw new Error("plan has unresolved dependencies");
    out.push(ready);
    for (const r of ready) { remaining.delete(r.id); for (const set of remaining.values()) set.delete(r.id); }
  }
  return out;
}

function systemPrompt() {
  const list = Object.values(agents()).map((a) => `- ${a.name}: ${a.description} Tools: ${a.tools.join(", ")}`).join("\n");
  return `You are the orchestrator for Tether, an event-operations assistant. Turn the organizer's request into a plan of 1 to 6 steps.
Available agents:
${list}

Rules:
- Use the fewest steps that fully cover the request. A simple question is one step.
- Each step is one agent with one clear instruction written for that agent, including any amounts, names, dates from the request.
- dependsOn lists step ids whose results this step needs (e.g. an announcement that needs a logo first). Independent steps run in parallel.
- needsApproval=true for anything that sends email, posts publicly, or spends money.
- Ids are s1..s6. Only use the agents listed.`;
}

export async function draftPlan(request: string, context?: string): Promise<{ plan: Plan; attempts: number; errors: string[] }> {
  let errors: string[] = [];
  let lastDraft: PlanDraft | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = attempt === 1
      ? `${context ? `Context:\n${context}\n\n` : ""}Request:\n${request}`
      : `Your previous plan had errors: ${errors.join("; ")}. Fix them.\n\nPrevious plan:\n${JSON.stringify(lastDraft)}\n\nRequest:\n${request}`;
    const draft = await generateStructured({ model: env().GEMINI_MODEL_PLANNER, system: systemPrompt(), prompt, schema: planSchema });
    lastDraft = draft;
    errors = validatePlan(draft);
    if (!errors.length) return { plan: toPlan(draft), attempts: attempt, errors: [] };
  }
  throw new Error(`planner failed validation: ${errors.join("; ")}`);
}

/** Tier 0/1: a prebuilt one-step plan that bypasses the orchestrator. */
export function singleStepPlan(agent: string, instruction: string, needsApproval = false): Plan {
  return { summary: instruction.slice(0, 120), steps: [{ id: "s1", agent, instruction, dependsOn: [], needsApproval, enabled: true }] };
}

/** Policy for skipping the plan card: one enabled step that the planner did not flag. */
export function requiresPlanCard(plan: Plan): boolean {
  const enabled = plan.steps.filter((s) => s.enabled);
  return enabled.length > 1 || enabled.some((s) => s.needsApproval);
}
