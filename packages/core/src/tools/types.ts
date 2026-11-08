import type { z } from "zod";
import type { Db } from "../db/client.js";
import type { orgs, users } from "../db/schema.js";
import type { Card } from "../ui/card.js";

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
  /** Redraw the run's status card from the rows (docs/GUIDE.md §5.3); the loop calls it after each tool call. */
  refreshStatus?: () => Promise<void>;
  /** Where the run renders (thread, else channel): the loop shows a typing indicator there before each model turn. */
  renderChannelId?: string;
  /** Attachments on the triggering message (receipts, photos). */
  attachments?: { url: string; contentType?: string; name?: string }[];
};

/** One input on the approval card's Edit modal (docs/CARDS.md §9). `key` is a top-level arg. */
export type EditField = { key: string; label: string; style: "short" | "paragraph"; required?: boolean };

export interface Tool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  input: I;
  effect: Effect;
  risk: Risk;
  /** One-line human summary for approval cards. */
  summarize: (args: z.infer<I>) => string;
  /** Args a reviewer may change on the approval card (at most 5, Discord's modal limit). Undeclared: one JSON field. */
  editFields?: EditField[];
  execute: (args: z.infer<I>, ctx: ToolCtx) => Promise<O>;
  /** Compensating action, when one exists. */
  undo?: (args: z.infer<I>, result: O, ctx: ToolCtx) => Promise<void>;
}

export function defineTool<I extends z.ZodTypeAny, O>(t: Tool<I, O>): Tool<I, O> {
  return t;
}

/**
 * A message body: a designed Card (rendered as Components V2 by the adapter) or plain text.
 * `text` stays supported so callers can migrate one at a time; when both are given the card wins.
 */
export type MessageBody = { text: string; card?: Card } | { text?: string; card: Card };
type Attachments = { attachments?: { name: string; data: Buffer }[] };

/** What core needs from the chat adapter. Implemented by apps/server with Discord. */
export interface Notifier {
  postPlanCard(input: { run: RunRef; plan: import("../db/schema.js").Plan; card?: Card }): Promise<{ channelId: string; messageId: string }>;
  postApprovalCards(input: { run: RunRef; actions: (ActionRef & { card?: Card })[] }): Promise<{ id: string; channelId: string; messageId: string }[]>;
  updateStatus(input: { run: RunRef; status: string } & ({ lines: string[]; card?: Card } | { lines?: string[]; card: Card })): Promise<void>;
  postSummary(input: { run: RunRef } & MessageBody & Attachments): Promise<void>;
  postToChannel(input: { channelId: string } & MessageBody & Attachments): Promise<{ messageId: string }>;
  /** Re-render a message the adapter posted earlier (approval card after a decision, etc.). */
  editMessage(input: { channelId: string; messageId: string } & MessageBody): Promise<void>;
  /** "Tether is typing…" for about ten seconds (docs/GUIDE.md §5.4). Best effort; never throws. */
  typing(input: { channelId: string }): Promise<void>;
  dm(input: { discordId: string } & MessageBody): Promise<void>;
  /** Recent image attachments in a channel, newest first (event photos the team dropped in #photos). */
  listChannelImages(input: { channelId: string; limit?: number }): Promise<ChannelImage[]>;
}

export type ChannelImage = {
  url: string;
  /** Discord's media proxy URL; accepts ?width=&height= for server-side downscaling. */
  proxyUrl?: string;
  contentType?: string;
  name?: string;
  bytes?: number;
  width?: number;
  height?: number;
  authorName?: string;
  postedAt: string;
  messageId: string;
};

export type RunRef = { id: string; orgId: string; source: Record<string, string | undefined>; request: string };
export type ActionRef = {
  id: string; tool: string; agent: string; summary: string; risk: Risk; effect: Effect; args: Record<string, unknown>;
  /** Minimum role that may decide it ("lead"); undefined = any organizer. */
  approverRole?: string;
};

export type UserRow = typeof users.$inferSelect;
