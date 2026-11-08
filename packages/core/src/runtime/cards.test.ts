import { test } from "node:test";
import assert from "node:assert/strict";
import type { actions } from "../db/schema.js";
import { settledDecision } from "./cards.js";

type Row = typeof actions.$inferSelect;
const at = new Date("2026-11-07T18:30:00Z");

function row(over: Partial<Row>): Row {
  return {
    id: "a1", orgId: "o1", runId: "r1", stepId: "s1", tool: "send_email", agent: "outreach", summary: "Send email",
    risk: "high", effect: "external", args: {}, status: "pending", approverRole: "lead", approverDiscordId: null,
    decidedAt: null, decisionNote: null, executedAt: null, result: null, messageRef: null,
    editedBy: null, editedAt: null, editedFields: null, createdAt: at,
    ...over,
  } as Row;
}

test("settledDecision: pending has no decision", () => {
  assert.equal(settledDecision(row({})), undefined);
});

test("settledDecision maps every settled status", () => {
  for (const status of ["approved", "executed", "failed", "rejected", "expired", "cancelled"] as const) {
    const d = settledDecision(row({ status, decidedAt: at }));
    assert.ok(d, status);
    assert.equal(d.status, status);
  }
});

test("settledDecision: `by` prefers the decider name, then mentions the approver", () => {
  const named = settledDecision(row({ status: "approved", approverDiscordId: "42", decidedAt: at }), "Fayez");
  assert.equal(named?.by, "Fayez");
  const mention = settledDecision(row({ status: "approved", approverDiscordId: "42", decidedAt: at }));
  assert.equal(mention?.by, "<@42>");
  const nobody = settledDecision(row({ status: "approved", decidedAt: at }));
  assert.equal(nobody?.by, undefined);
});

test("settledDecision: timestamps prefer executedAt over decidedAt", () => {
  const exec = new Date("2026-11-07T18:31:00Z");
  const d = settledDecision(row({ status: "executed", decidedAt: at, executedAt: exec }));
  assert.equal(d?.at, exec);
  const d2 = settledDecision(row({ status: "approved", decidedAt: at }));
  assert.equal(d2?.at, at);
});

test("settledDecision: failed carries the tool error; rejected/expired/cancelled carry the note", () => {
  assert.equal(settledDecision(row({ status: "failed", result: { error: "Gmail 403" } }))?.note, "Gmail 403");
  assert.equal(settledDecision(row({ status: "failed", result: { ok: true } }))?.note, undefined);
  assert.equal(settledDecision(row({ status: "rejected", decisionNote: "wrong sponsor" }))?.note, "wrong sponsor");
  assert.equal(settledDecision(row({ status: "expired", decisionNote: "the run failed before a decision" }))?.note, "the run failed before a decision");
  assert.equal(settledDecision(row({ status: "cancelled", decisionNote: "run stopped" }))?.note, "run stopped");
  // expired never names anyone: there was no decider.
  assert.equal(settledDecision(row({ status: "expired", approverDiscordId: "42" }))?.by, undefined);
});
