import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineTool, type Tool } from "../tools/types.js";
import { JSON_FIELD, applyEdit, editFieldsFor, fieldValue } from "./edit.js";

const expense = defineTool({
  name: "fake_expense", description: "test tool", effect: "write", risk: "medium",
  input: z.object({
    amount: z.number().positive(),
    category: z.string().min(1),
    vendor: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reimbursable: z.boolean().default(false),
  }),
  editFields: [{ key: "amount", label: "Amount", style: "short" }, { key: "category", label: "Category", style: "short" }],
  summarize: () => "fake",
  execute: async () => ({}),
}) as unknown as Tool;

const base = { amount: 84.2, category: "Food", vendor: "Pizza Nova" };

test("applyEdit coerces modal text to the arg's zod type", () => {
  const r = applyEdit(expense, base, { amount: "$1,200.50" });
  assert.ok(r.ok);
  assert.equal(r.args.amount, 1200.5);
  assert.deepEqual(r.changed, ["amount"]);
});

test("applyEdit splits arrays on commas and newlines", () => {
  const r = applyEdit(expense, base, { tags: "pizza, catering\nsaturday" });
  assert.ok(r.ok);
  assert.deepEqual(r.args.tags, ["pizza", "catering", "saturday"]);
  assert.deepEqual(r.changed, ["tags"]);
});

test("applyEdit coerces booleans", () => {
  const r = applyEdit(expense, base, { reimbursable: "yes" });
  assert.ok(r.ok);
  assert.equal(r.args.reimbursable, true);
  assert.deepEqual(r.changed, ["reimbursable"]);
});

test("applyEdit: empty text clears an optional arg", () => {
  const r = applyEdit(expense, base, { vendor: "" });
  assert.ok(r.ok);
  assert.ok(!("vendor" in r.args));
  assert.deepEqual(r.changed, ["vendor"]);
});

test("applyEdit: schema defaults never read as edits", () => {
  const r = applyEdit(expense, base, { category: "Food" });
  assert.ok(r.ok);
  assert.equal(r.args.reimbursable, false);
  assert.deepEqual(r.changed, []);
});

test("applyEdit rejects input the schema refuses and names the field", () => {
  const r = applyEdit(expense, base, { amount: "abc" });
  assert.ok(!r.ok);
  assert.match(r.error, /\*\*amount\*\*/);
  const neg = applyEdit(expense, base, { amount: "-5" });
  assert.ok(!neg.ok);
  assert.match(neg.error, /\*\*amount\*\*/);
});

test("applyEdit: required field cannot be cleared", () => {
  const r = applyEdit(expense, base, { category: "" });
  assert.ok(!r.ok);
  assert.match(r.error, /\*\*category\*\*/);
});

test("applyEdit JSON mode replaces the whole object", () => {
  const r = applyEdit(expense, base, { [JSON_FIELD.key]: JSON.stringify({ amount: 2, category: "Prizes" }) });
  assert.ok(r.ok);
  assert.deepEqual(r.args, { amount: 2, category: "Prizes", reimbursable: false });
  assert.deepEqual(r.changed.sort(), ["amount", "category", "vendor"]);
});

test("applyEdit JSON mode rejects bad JSON and non-objects", () => {
  const bad = applyEdit(expense, base, { [JSON_FIELD.key]: "{" });
  assert.ok(!bad.ok);
  assert.match(bad.error, /not valid JSON/);
  const arr = applyEdit(expense, base, { [JSON_FIELD.key]: "[1,2]" });
  assert.ok(!arr.ok);
  assert.match(arr.error, /JSON object/);
});

test("editFieldsFor caps at five fields and falls back to the JSON field", () => {
  const many = { ...expense, editFields: Array.from({ length: 7 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, style: "short" as const })) } as Tool;
  assert.equal(editFieldsFor(many).length, 5);
  assert.deepEqual(editFieldsFor(undefined), [JSON_FIELD]);
  assert.deepEqual(editFieldsFor({ ...expense, editFields: undefined } as Tool), [JSON_FIELD]);
  assert.deepEqual(editFieldsFor({ ...expense, editFields: [] } as Tool), [JSON_FIELD]);
  assert.equal(editFieldsFor(expense).length, 2);
});

test("fieldValue renders args as modal text", () => {
  const args = { to: ["a@x.com", "b@x.com"], meta: { k: 1 }, n: 3, nothing: null };
  assert.equal(fieldValue(args, "to"), "a@x.com, b@x.com");
  assert.equal(fieldValue(args, "meta"), '{"k":1}');
  assert.equal(fieldValue(args, "n"), "3");
  assert.equal(fieldValue(args, "nothing"), "");
  assert.equal(fieldValue(args, "missing"), "");
  assert.equal(fieldValue(args, JSON_FIELD.key), JSON.stringify(args, null, 2));
});
