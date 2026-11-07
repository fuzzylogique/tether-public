import type { z } from "zod";
import type { Db } from "../db/client.js";
import type { orgs, users } from "../db/schema.js";

export type Effect = "read" | "write" | "external";
export type Risk = "low" | "medium" | "high";

export type Actor = {
  userId?: string;
  discordId?: string;
  name?: string;
  roles: string[];
};

export type ToolCtx = {
  db: Db;
  org: typeof orgs.$inferSelect;
  actor: Actor;
  runId: string;
  stepId?: string;
  agent: string;
  /** Side channel to the adapter (Discord). */
  notify: Notifier;
  /** Attachments on the triggering message (receipts, photos). */
  attachments?: { url: string; contentType?: string; name?: string }[];
};

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  input: I;
  effect: Effect;
  risk: Risk;
  /** One-line human summary for approval cards. */
  summarize: (args: z.infer<I>) => string;
  execute: (args: z.infer<I>, ctx: ToolCtx) => Promise<O>;
  /** Compensating action, when one exists. */
  undo?: (args: z.infer<I>, result: O, ctx: ToolCtx) => Promise<void>;
}

export function defineTool<I extends z.ZodTypeAny, O>(t: Tool<I, O>): Tool<I, O> {
  return t;
}

/** What core needs from the chat adapter. Implemented by apps/server with Discord. */
export interface Notifier {
  postPlanCard(input: { run: RunRef; plan: import("../db/schema.js").Plan }): Promise<{ channelId: string; messageId: string }>;
  postApprovalCards(input: { run: RunRef; actions: ActionRef[] }): Promise<{ id: string; channelId: string; messageId: string }[]>;
  updateStatus(input: { run: RunRef; lines: string[]; status: string }): Promise<void>;
  postSummary(input: { run: RunRef; text: string; attachments?: { name: string; data: Buffer }[] }): Promise<void>;
  postToChannel(input: { channelId: string; text: string; attachments?: { name: string; data: Buffer }[] }): Promise<{ messageId: string }>;
  dm(input: { discordId: string; text: string }): Promise<void>;
}

export type RunRef = { id: string; orgId: string; source: Record<string, string | undefined>; request: string };
export type ActionRef = {
  id: string; tool: string; agent: string; summary: string; risk: Risk; effect: Effect; args: Record<string, unknown>;
};

export type UserRow = typeof users.$inferSelect;
