import { test } from "node:test";
import assert from "node:assert/strict";
import { nowLine, validatePlan } from "./planner.js";

const step = (id: string, agent: string, dependsOn: string[] = []) => ({ id, agent, instruction: "x", dependsOn, needsApproval: false });

test("validatePlan rejects the same agent in two steps (tool results do not pass between steps)", () => {
  const errors = validatePlan({ summary: "s", steps: [step("s1", "socials"), step("s2", "socials", ["s1"])] });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /agent "socials" is used in s1 and s2/);
});

test("validatePlan accepts one step per agent with dependencies", () => {
  assert.deepEqual(validatePlan({ summary: "s", steps: [step("s1", "outreach"), step("s2", "finance", ["s1"]), step("s3", "socials", ["s1"])] }), []);
});

test("validatePlan still catches cycles and unknown agents", () => {
  const errors = validatePlan({ summary: "s", steps: [step("s1", "finance", ["s2"]), step("s2", "nope", ["s1"])] });
  assert.ok(errors.some((e) => e.includes("unknown agent")));
  assert.ok(errors.some((e) => e.includes("cycle")));
});

test("nowLine carries the Toronto weekday so 'Sunday' at 1am is today", () => {
  const line = nowLine(new Date("2026-11-08T06:41:00Z"));
  assert.match(line, /^Now: 2026-11-08T06:41:00\.000Z \(Sunday, November 8, 2026/);
  assert.match(line, /1:41 a\.m\.|01:41|1:41/);
});
