import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { defineTool } from "./types.js";
import { processedMail, sponsors, sponsorThreads } from "../db/schema.js";
import { createDraft, searchMail, sendEmail } from "../google/gmail.js";

export const listSponsors = defineTool({
  name: "list_sponsors",
  description: "List sponsors in the pipeline with stage, amount, last contact, and deliverables.",
  input: z.object({ stage: z.string().optional(), staleDays: z.number().optional().describe("Only sponsors not contacted in N days") }),
  effect: "read", risk: "low",
  summarize: (a) => `List sponsors${a.stage ? ` in ${a.stage}` : ""}`,
  async execute(args, ctx) {
    const rows = await ctx.db.select().from(sponsors).where(eq(sponsors.orgId, ctx.org.id));
    const cutoff = args.staleDays ? Date.now() - args.staleDays * 86400_000 : undefined;
    return rows
      .filter((s) => !args.stage || s.stage === args.stage)
      .filter((s) => !cutoff || !s.lastContactAt || s.lastContactAt.getTime() < cutoff)
      .map((s) => ({ id: s.id, name: s.name, contactName: s.contactName, contactEmail: s.contactEmail, stage: s.stage, amount: s.amount, tier: s.tier, lastContactAt: s.lastContactAt, notes: s.notes, deliverables: s.deliverables }));
  },
});

export const updateSponsor = defineTool({
  name: "update_sponsor",
  description: "Update a sponsor's stage, amount, tier, notes, or deliverables checklist.",
  input: z.object({
    sponsorName: z.string(),
    stage: z.enum(["lead", "contacted", "replied", "negotiating", "confirmed", "declined"]).optional(),
    amount: z.number().optional(),
    tier: z.string().optional(),
    notes: z.string().optional(),
    deliverables: z.array(z.object({ title: z.string(), done: z.boolean() })).optional(),
  }),
  effect: "write", risk: "low",
  summarize: (a) => `Update sponsor ${a.sponsorName}${a.stage ? ` → ${a.stage}` : ""}`,
  async execute(args, ctx) {
    const [s] = await ctx.db.select().from(sponsors).where(and(eq(sponsors.orgId, ctx.org.id), ilike(sponsors.name, args.sponsorName)));
    if (!s) return { error: `sponsor ${args.sponsorName} not found` };
    const [updated] = await ctx.db.update(sponsors).set({
      stage: args.stage ?? s.stage, amount: args.amount != null ? args.amount.toFixed(2) : s.amount, tier: args.tier ?? s.tier,
      notes: args.notes ?? s.notes, deliverables: args.deliverables ?? s.deliverables,
    }).where(eq(sponsors.id, s.id)).returning();
    return { id: updated!.id, stage: updated!.stage };
  },
});

export const createEmailDraft = defineTool({
  name: "create_email_draft",
  description: "Create a Gmail draft (not sent). Use when the organizer wants to review in Gmail.",
  input: z.object({ to: z.string().email(), subject: z.string(), body: z.string(), cc: z.string().optional() }),
  effect: "write", risk: "low",
  summarize: (a) => `Draft email to ${a.to}: ${a.subject}`,
  async execute(args) { return createDraft(args); },
});

export const sendSponsorEmail = defineTool({
  name: "send_email",
  description: "Send an email from the organizer account. Always gated by approval. Include the full body.",
  input: z.object({
    to: z.string().email(), subject: z.string(), body: z.string(), cc: z.string().optional(),
    sponsorName: z.string().optional().describe("Link this email to a sponsor record"),
    threadId: z.string().optional().describe("Gmail thread id to reply within"),
  }),
  effect: "external", risk: "high",
  summarize: (a) => `Send email to ${a.to}: "${a.subject}"`,
  async execute(args, ctx) {
    const sent = await sendEmail(args);
    if (args.sponsorName) {
      const [s] = await ctx.db.select().from(sponsors).where(and(eq(sponsors.orgId, ctx.org.id), ilike(sponsors.name, args.sponsorName)));
      if (s) {
        await ctx.db.update(sponsors).set({ lastContactAt: new Date(), stage: s.stage === "lead" ? "contacted" : s.stage }).where(eq(sponsors.id, s.id));
        await ctx.db.insert(sponsorThreads).values({ orgId: ctx.org.id, sponsorId: s.id, gmailThreadId: sent.threadId, lastMessageId: sent.messageId, lastDirection: "outbound", lastSnippet: args.subject })
          .onConflictDoUpdate({ target: sponsorThreads.gmailThreadId, set: { lastMessageId: sent.messageId, lastDirection: "outbound", lastSnippet: args.subject, updatedAt: new Date() } });
      }
    }
    // `lastMessageId` is informational only; inbound dedup is the processed_mail primary key
    // (see inngest/functions/monitors.ts). Mark our own outbound id as processed too, so the
    // poller can never treat the organizer's reply as a new inbound message.
    if (sent.messageId && sent.threadId) {
      await ctx.db.insert(processedMail).values({ messageId: sent.messageId, orgId: ctx.org.id, threadId: sent.threadId }).onConflictDoNothing();
    }
    return sent;
  },
});

export const searchSponsorReplies = defineTool({
  name: "search_sponsor_replies",
  description: "Search the organizer inbox for recent emails, e.g. replies from a sponsor domain.",
  input: z.object({ query: z.string().describe("Gmail search query, e.g. 'from:shopify.com newer_than:7d'"), max: z.number().max(20).default(5) }),
  effect: "read", risk: "low",
  summarize: (a) => `Search mail: ${a.query}`,
  async execute(args) { return searchMail(args.query, args.max); },
});

export const outreachTools = [listSponsors, updateSponsor, createEmailDraft, sendSponsorEmail, searchSponsorReplies];
