import { z } from "zod";
import type { Plan, PlanStep } from "../db/schema.js";

/**
 * Standing workflows: prebuilt multi-step plans (a DAG of agent steps) that fire on an event
 * instead of an organizer's request. They are approved once, when the org turns them on, so no
 * plan card is posted; every side effect inside still goes through `policy.decide()`, so money
 * and email are gated exactly as they are for human-requested plans.
 */
export type WorkflowTemplate<P extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  label: string;
  description: string;
  /** What fires it, as a phrase after "fires": shown on the /help workflows topic. */
  trigger: string;
  /** Team channel key the run renders into (falls back to ops). */
  channel: string;
  params: P;
  /** One line for the run card. */
  describe: (p: z.infer<P>) => string;
  build: (p: z.infer<P>) => Plan;
};

function step(id: string, agent: string, instruction: string, dependsOn: string[] = [], needsApproval = false): PlanStep {
  return { id, agent, instruction, dependsOn, needsApproval, enabled: true };
}

function define<P extends z.ZodTypeAny>(t: WorkflowTemplate<P>): WorkflowTemplate<P> { return t; }

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const sponsorConfirmed = define({
  name: "sponsor-confirmed",
  label: "Sponsor confirmed",
  description: "A sponsor committed money: record the income on the sheet, create the deliverable tasks, and draft the welcome announcement.",
  trigger: "when a sponsor moves to confirmed (by an agent or a human), or `/workflow run`",
  channel: "sponsorship",
  params: z.object({
    sponsor: z.string(),
    amount: z.number().positive().optional(),
    tier: z.string().optional(),
    contactName: z.string().optional(),
    deliverables: z.array(z.string()).default([]),
  }),
  describe: (p) => `${p.sponsor} confirmed${p.amount ? ` ${money(p.amount)}` : ""}${p.tier ? ` (${p.tier})` : ""}`,
  build: (p) => {
    const amount = p.amount ? money(p.amount) : "the agreed amount";
    const deliverables = p.deliverables.length ? p.deliverables.join("; ") : "the usual tier deliverables: logo on the website, a social mention, and a booth table";
    return {
      summary: `Onboard ${p.sponsor} as a confirmed sponsor`,
      steps: [
        step("s1", "finance", `${p.sponsor} confirmed a sponsorship of ${amount}${p.tier ? ` at the ${p.tier} tier` : ""}. Record it as pledged income with log_income (source "${p.sponsor} sponsorship", sponsorName "${p.sponsor}"${p.amount ? `, amount ${p.amount}` : ""}); a human approves the sheet entry. Then report the updated income and net position in one line.`, [], true),
        step("s2", "coordination", `${p.sponsor} is now a confirmed sponsor. Create one task per deliverable we owe them (${deliverables}), owned by the lead, due two days before the event. Keep titles short, e.g. "${p.sponsor}: logo on website".`),
        step("s3", "socials", `Draft a short, warm Discord announcement welcoming ${p.sponsor} as a${p.tier ? ` ${p.tier}` : ""} sponsor${p.contactName ? ` (contact ${p.contactName})` : ""}. Post it to the announcements channel (it will be approved by a human first). Skip the image if generation is unavailable.`, ["s1"], true),
      ],
    };
  },
});

export const sponsorLead = define({
  name: "sponsor-lead",
  label: "New sponsor lead",
  description: "A new company to pitch: add them to the pipeline, draft the intro email, and schedule the follow-up.",
  trigger: "on `/workflow run` only",
  channel: "sponsorship",
  params: z.object({ sponsor: z.string(), contactEmail: z.string().email().optional(), contactName: z.string().optional(), notes: z.string().optional() }),
  describe: (p) => `${p.sponsor}${p.contactName ? ` via ${p.contactName}` : ""}`,
  build: (p) => ({
    summary: `Start outreach to ${p.sponsor}`,
    steps: [
      step("s1", "outreach", `Add ${p.sponsor} to the pipeline as a lead${p.contactName ? ` (contact ${p.contactName}${p.contactEmail ? `, ${p.contactEmail}` : ""})` : ""}${p.notes ? `. Notes: ${p.notes}` : ""}. If they already exist, update the contact details instead.`),
      step("s2", "outreach", `Write the intro sponsorship pitch email to ${p.sponsor}${p.contactEmail ? ` (${p.contactEmail})` : ""} and send it with send_email (a human approves it first). Keep it under 150 words and mention the event dates and audience.`, ["s1"], true),
      step("s3", "coordination", `Create a task "Follow up with ${p.sponsor}" owned by the lead, due in 5 days.`, ["s1"]),
    ],
  }),
});

export const WORKFLOWS: Record<string, WorkflowTemplate> = Object.fromEntries(
  [sponsorConfirmed, sponsorLead].map((w) => [w.name, w as unknown as WorkflowTemplate]),
);

export function workflowNames() { return Object.keys(WORKFLOWS); }
