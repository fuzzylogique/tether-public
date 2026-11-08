import { test } from "node:test";
import assert from "node:assert/strict";
import { shortArg, toolCallEvent } from "./toollog.js";

test("shortArg: first non-empty string, one line, 40 characters", () => {
  assert.equal(shortArg({ limit: 5, stage: "confirmed" }), "confirmed");
  assert.equal(shortArg({ a: "", b: "  ", c: "Shopify" }), "Shopify");
  assert.equal(shortArg({ body: "Hi Priya,\n\nThanks   again for confirming the Gold tier sponsorship" }), "Hi Priya, Thanks again for confirming t…");
  assert.equal(shortArg({ amount: 84.2, paid: true }), undefined);
});

test("toolCallEvent carries what the status card reads", () => {
  const e = toolCallEvent({ tool: "list_sponsors", args: { stage: "lead" }, stepId: "s1" });
  assert.deepEqual(e, { tool: "list_sponsors", args: { stage: "lead" }, stepId: "s1", summary: "lead", error: undefined });
});
