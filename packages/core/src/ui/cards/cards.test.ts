import { test } from "node:test";
import assert from "node:assert/strict";
import type { Action } from "../card.js";
import { APPROVALS } from "../fixtures.js";
import { approvalCard } from "./approval.js";
import { isLiveRun, statusCard, toolLog, type StepState } from "./status.js";

const flat = (actions?: Action[][]) => (actions ?? []).flat();
const buttonIds = (actions?: Action[][]) => flat(actions).flatMap((a) => (a.kind === "button" ? [a.id] : []));
const linkLabels = (actions?: Action[][]) => flat(actions).flatMap((a) => (a.kind === "link" ? [a.label] : []));

test("statusCard offers Stop exactly while the run is live", () => {
  for (const status of ["approved", "running", "awaiting_approval"]) {
    assert.ok(isLiveRun(status), status);
    const card = statusCard({ runId: "r1", request: "x", status, steps: [] });
    const stop = flat(card.actions).find((a) => a.kind === "button" && a.id === "run:stop:r1");
    assert.ok(stop && stop.kind === "button" && stop.style === "danger", `${status} should offer Stop`);
  }
  for (const status of ["proposed", "done", "failed", "cancelled", "expired"]) {
    assert.ok(!isLiveRun(status), status);
    assert.deepEqual(buttonIds(statusCard({ runId: "r1", request: "x", status, steps: [] }).actions), [], `${status} must not offer Stop`);
  }
});

test("statusCard: a stopped run with steps is titled Stopped and links pending approvals", () => {
  const stopped = statusCard({
    runId: "r1", request: "x", status: "cancelled", stoppedBy: "<@1>",
    steps: [{ id: "s1", agent: "outreach", instruction: "i", status: "cancelled" }],
  });
  assert.equal(stopped.title, "Stopped");
  const waiting = statusCard({
    runId: "r1", request: "x", status: "awaiting_approval",
    steps: [{ id: "s1", agent: "outreach", instruction: "i", status: "awaiting_approval" }],
    pending: [{ stepKey: "s1", summary: "Send email", url: "https://discord.com/channels/1/2/3" }],
  });
  assert.ok(linkLabels(waiting.actions).some((l) => l.startsWith("Jump")), "pending approvals get Jump links");
});

test("approvalCard: pending has Approve/Edit/Reject, decided has none", () => {
  const a = APPROVALS.email;
  assert.deepEqual(buttonIds(approvalCard(a).actions), [`action:approve:${a.id}`, `action:edit:${a.id}`, `action:reject:${a.id}`]);
  for (const status of ["approved", "executed", "failed", "rejected", "expired", "cancelled"] as const) {
    assert.deepEqual(buttonIds(approvalCard(a, { decision: { status, at: 0 } }).actions), [], status);
  }
});

test("approvalCard: the ↩ Run link follows context.runUrl, decided or not", () => {
  const a = APPROVALS.email;
  const url = "https://discord.com/channels/1/2/3";
  assert.deepEqual(linkLabels(approvalCard(a).actions), []);
  assert.deepEqual(linkLabels(approvalCard(a, { context: { runUrl: url } }).actions), ["↩ Run"]);
  const decided = approvalCard(a, { context: { runUrl: url }, decision: { status: "executed", at: 0 } });
  assert.deepEqual(linkLabels(decided.actions), ["↩ Run"]);
  assert.deepEqual(buttonIds(decided.actions), []);
});

test("approvalCard: the gate names the approver role when the policy set one", () => {
  assert.match(approvalCard(APPROVALS.email).subtitle ?? "", /risk high · needs lead/);
  assert.match(approvalCard(APPROVALS.expense).subtitle ?? "", /risk medium$/);
});

test("toolLog: at most three lines, oldest first, only under a running step", () => {
  const recent = [1, 2, 3, 4, 5].map((n) => ({ tool: `t${n}`, at: n * 1000 }));
  const running: StepState = { id: "s", agent: "finance", instruction: "x", status: "running", recent };
  const lines = toolLog(running);
  assert.equal(lines.length, 4, "three tool lines plus thinking…");
  assert.match(lines[0]!, /t3/); assert.match(lines[2]!, /t5/);
  assert.match(lines[3]!, /thinking…/);
  assert.deepEqual(toolLog({ ...running, recent: undefined }), ["-# :tether_running: thinking…"]);
  for (const status of ["pending", "awaiting_approval", "done", "failed", "cancelled", "skipped"] as const) {
    assert.deepEqual(toolLog({ ...running, status }), [], status);
  }
  const failed = toolLog({ ...running, recent: [{ tool: "sync_budget_from_sheet", at: 0, error: "sheet not shared" }] });
  assert.match(failed[0]!, /⚠️ sync_budget_from_sheet · sheet not shared/);
  const summarised = toolLog({ ...running, recent: [{ tool: "list_sponsors", summary: "Shopify", at: 0 }] });
  assert.match(summarised[0]!, /🔎 list_sponsors · Shopify/);
});
