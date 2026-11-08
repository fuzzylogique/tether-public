import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRunStatus } from "./status.js";

test("deriveRunStatus: live rows follow their steps", () => {
  assert.equal(deriveRunStatus("running", ["done", "running"]), "running");
  assert.equal(deriveRunStatus("running", ["done", "awaiting_approval"]), "awaiting_approval");
  // Stale row after a decision: one step still waits, so the card still says waiting.
  assert.equal(deriveRunStatus("awaiting_approval", ["awaiting_approval", "running"]), "awaiting_approval");
  // Stale row after the last decision: nothing waits, so it is running again.
  assert.equal(deriveRunStatus("awaiting_approval", ["running", "done"]), "running");
  assert.equal(deriveRunStatus("running", []), "running");
});

test("deriveRunStatus: settled rows are final whatever the steps say", () => {
  for (const s of ["proposed", "approved", "done", "failed", "cancelled", "expired"]) {
    assert.equal(deriveRunStatus(s, ["awaiting_approval"]), s);
  }
});
