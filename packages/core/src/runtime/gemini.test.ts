import { test } from "node:test";
import assert from "node:assert/strict";
import { NonRetriableError } from "inngest";
import { ai, draftFailureNote, generateWithRetry } from "./gemini.js";

const NO_CREDITS = '{"error":{"code":402,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}';

test("generateWithRetry gives up on a 402 without backing off, after trying the fallback model", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_API_KEYS = "";
  process.env.GEMINI_MODEL_FALLBACK = "fallback-model";
  const calls: string[] = [];
  (ai("test-key").models as unknown as { generateContent: (p: { model: string }) => Promise<never> }).generateContent = async ({ model }) => {
    calls.push(model);
    throw new Error(NO_CREDITS);
  };
  const started = Date.now();
  await assert.rejects(generateWithRetry({ model: "main-model", contents: "x" }), NonRetriableError);
  assert.deepEqual(calls, ["main-model", "fallback-model"]);
  assert.ok(Date.now() - started < 1000, "must not sit in exponential backoff");
});

test("draftFailureNote turns API errors into a sentence for the status card", () => {
  assert.match(draftFailureNote(NO_CREDITS), /out of prepaid credits/);
  assert.match(draftFailureNote("Quota exceeded: requests per day"), /daily quota/);
  assert.match(draftFailureNote("planner failed validation: x"), /valid plan/);
  assert.match(draftFailureNote("boom"), /could not draft a plan: boom/);
});
