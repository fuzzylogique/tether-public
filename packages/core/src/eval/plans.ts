import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { draftPlan } from "../runtime/planner.js";

/**
 * Planner fixtures. Run `pnpm eval:plans`.
 * Decision gate (see docs/ARCHITECTURE.md): >85% valid & agent-F1 > 0.8 → keep DAG; 60–85% → plan card always; <60% → sequential.
 */
const fixtures: { request: string; agents: string[]; mustDepend?: [string, string][] }[] = [
  { request: "How much of the food budget is left?", agents: ["finance"] },
  { request: "Log $84.20 at Costco for snacks", agents: ["finance"] },
  { request: "Follow up with every sponsor we haven't heard from in 5 days", agents: ["outreach"] },
  { request: "Shopify confirmed $2k gold. Kick off onboarding.", agents: ["outreach", "finance", "socials", "coordination"], mustDepend: [["socials", "outreach"]] },
  { request: "Schedule the judge briefing Saturday 9am and invite the judges", agents: ["calendar"] },
  { request: "Who owns the badge printing task and is it late?", agents: ["coordination"] },
  { request: "Draft an Instagram post announcing the opening ceremony at 6pm Friday", agents: ["socials"] },
  { request: "We're over budget on swag. Cancel the lanyard order and tell the sponsor lead", agents: ["finance", "coordination"] },
  { request: "What time is the submission deadline?", agents: ["helpdesk"] },
  { request: "Add a task for Jordan to book A/V by tomorrow and remind him Friday morning", agents: ["coordination", "calendar"] },
  { request: "Send TigerData a thank you and schedule their workshop Saturday 2pm", agents: ["outreach", "calendar"] },
  { request: "Post the Vultr sponsor announcement and mark their social mention deliverable done", agents: ["socials", "outreach"], mustDepend: [["outreach", "socials"]] },
];

let valid = 0, tp = 0, fp = 0, fn = 0, depOk = 0, depTotal = 0;
for (const f of fixtures) {
  try {
    const { plan, attempts } = await draftPlan(f.request);
    valid++;
    const got = new Set(plan.steps.map((s) => s.agent));
    const want = new Set(f.agents);
    for (const a of got) (want.has(a) ? tp++ : fp++);
    for (const a of want) if (!got.has(a)) fn++;
    for (const [a, b] of f.mustDepend ?? []) {
      depTotal++;
      const sa = plan.steps.find((s) => s.agent === a), sb = plan.steps.find((s) => s.agent === b);
      if (sa && sb && sa.dependsOn.includes(sb.id)) depOk++;
    }
    console.log(`✔ (${attempts}) ${f.request}\n    → ${plan.steps.map((s) => `${s.id}:${s.agent}${s.dependsOn.length ? `←${s.dependsOn.join(",")}` : ""}`).join("  ")}`);
  } catch (e) {
    console.log(`✘ ${f.request}\n    ${e instanceof Error ? e.message : e}`);
  }
}
const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
console.log(`\nvalid: ${valid}/${fixtures.length} (${Math.round((100 * valid) / fixtures.length)}%)  agent precision ${p.toFixed(2)} recall ${r.toFixed(2)} F1 ${((2 * p * r) / (p + r || 1)).toFixed(2)}  deps ${depOk}/${depTotal}`);
