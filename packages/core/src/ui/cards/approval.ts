import type { ActionRef } from "../../tools/types.js";
import { AMBER, GREEN, GREY, RED } from "../tokens.js";
import { fmtMoney, kv, kvText, progress, shortId, text, truncate, ts, type Action, type Block, type Card } from "../card.js";
import { agentMeta } from "./agent.js";

export type ApprovalContext = {
  /** Budget line for the expense category, for the "before → after" line on log_expense. */
  budget?: { category: string; allocated: number; spent: number };
  channels?: Record<string, string>;
  conflicts?: { title: string; start: string }[];
  /** Link to the run's status card (the "↩ Run" button). */
  runUrl?: string;
};

/**
 * How the card left (or is leaving) `pending`. `approved` is the transient state between a human's
 * yes and the executor's re-render; `cancelled` is a run stopped before a decision (docs/CARDS.md §2).
 */
export type ApprovalDecision = {
  status: "approved" | "rejected" | "executed" | "failed" | "expired" | "cancelled";
  by?: string;
  at?: Date | string | number;
  note?: string;
};

/** A save from the Edit modal. The card stays pending; Approve is a separate click (docs/CARDS.md §9). */
export type ApprovalEdit = { by?: string; at?: Date | string | number; fields?: string[] };

const DECISION_ACCENT: Record<ApprovalDecision["status"], string> = {
  approved: AMBER, executed: GREEN, rejected: RED, failed: RED, expired: GREY, cancelled: GREY,
};

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const channel = (ctx: ApprovalContext | undefined, key: string) => ctx?.channels?.[key] ? `<#${ctx.channels[key]}>` : `#${key} (not configured)`;
const blockquote = (s: string, max = 1500) => `>>> ${truncate(s.trim(), max)}`;

function emailBlocks(args: Record<string, unknown>): Block[] {
  return [
    kv([
      ["To", str(args.to)],
      ["Cc", str(args.cc) || "none"],
      ["Subject", str(args.subject)],
      ...(args.threadId ? [["Thread", `\`${str(args.threadId)}\` (reply)`] as [string, string]] : []),
      ...(args.sponsorName ? [["Sponsor", str(args.sponsorName)] as [string, string]] : []),
    ]),
    text(blockquote(str(args.body), 1800)),
  ];
}

function expenseBlocks(args: Record<string, unknown>, ctx?: ApprovalContext): Block[] {
  const amount = Number(args.amount ?? 0);
  const rows: [string, string][] = [
    ["Amount", fmtMoney(amount, { cents: true })],
    ["Category", str(args.category)],
    ["Vendor", str(args.vendor) || "none"],
    ["Date", str(args.date) || "today"],
    ...(args.description ? [["Note", truncate(str(args.description), 200)] as [string, string]] : []),
  ];
  const b = ctx?.budget;
  const budgetLine = b
    ? (() => {
        const after = b.spent + amount;
        const pct = b.allocated ? Math.round((after / b.allocated) * 100) : 0;
        const warn = pct > 95 ? " :tether_failed: over budget" : pct > 80 ? " ⚠️ nearly spent" : "";
        return `**${b.category}** ${fmtMoney(b.spent)} → **${fmtMoney(after)}** of ${fmtMoney(b.allocated)}\n${progress(after, b.allocated, 10)}  ${pct}%${warn}`;
      })()
    : "";
  if (args.receiptUrl) {
    return [{ kind: "section", md: [kvText(rows), budgetLine].filter(Boolean), thumb: { url: str(args.receiptUrl), alt: "receipt" } }];
  }
  return [kv(rows), ...(budgetLine ? [text(budgetLine)] : [])];
}

function eventBlocks(args: Record<string, unknown>, ctx?: ApprovalContext): Block[] {
  const attendees = Array.isArray(args.attendees) ? (args.attendees as string[]) : [];
  const blocks: Block[] = [kv([
    ["Title", str(args.title)],
    ["When", args.start ? `${ts(str(args.start), "F")} → ${args.end ? ts(str(args.end), "t") : "?"}` : "unspecified"],
    ["Where", str(args.location) || "none"],
    ["Attendees", attendees.length ? `${attendees.length} · ${truncate(attendees.join(", "), 300)}` : "none"],
  ])];
  if (args.description) blocks.push(text(blockquote(str(args.description), 600)));
  if (ctx?.conflicts?.length) blocks.push(text(`⚠️ **Conflicts** ${ctx.conflicts.map((c) => `${c.title} ${ts(c.start, "t")}`).join(", ")}`));
  return blocks;
}

function fallbackBlocks(args: Record<string, unknown>): Block[] {
  // Never hide an argument: scalars inline, objects as a short JSON block.
  const rows: [string, string][] = [];
  const objects: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v !== null && typeof v === "object") objects.push(`**${k}**\n\`\`\`json\n${truncate(JSON.stringify(v, null, 2), 600)}\n\`\`\``);
    else rows.push([k, v === "" || v === undefined || v === null ? "none" : truncate(String(v), 300)]);
  }
  return [...(rows.length ? [kv(rows)] : []), ...objects.map(text)];
}

function bodyFor(a: ActionRef, ctx?: ApprovalContext): Block[] {
  const args = a.args;
  switch (a.tool) {
    case "send_email":
    case "create_email_draft":
      return emailBlocks(args);
    case "post_announcement": {
      const urls = [...(args.imageUrl ? [str(args.imageUrl)] : []), ...(Array.isArray(args.imageUrls) ? (args.imageUrls as unknown[]).map(str) : [])].slice(0, 4);
      return [
        kv([["Channel", channel(ctx, "announcements")], ...(urls.length ? [["Images", String(urls.length)] as [string, string]] : [])]),
        text(blockquote(str(args.text), 1800)),
        ...(urls.length ? [{ kind: "gallery", items: urls.map((url, i) => ({ url, alt: urls.length === 1 ? "hero image" : `photo ${i + 1}` })) } as Block] : []),
      ];
    }
    case "post_instagram": {
      const urls = (Array.isArray(args.imageUrls) ? (args.imageUrls as unknown[]).map(str) : []).slice(0, 10);
      return [
        kv([["Publishes to", "Instagram (public)"], ["Format", urls.length > 1 ? `Carousel of ${urls.length}, cropped 4:5` : "Single photo"]]),
        text(blockquote(str(args.caption), 1800)),
        ...(urls.length ? [{ kind: "gallery", items: urls.map((url, i) => ({ url, alt: `photo ${i + 1}` })) } as Block] : []),
      ];
    }
    case "request_drive_access": {
      const teams = Array.isArray(args.teams) ? (args.teams as unknown[]).map(str) : [];
      const people = Array.isArray(args.discordIds) ? (args.discordIds as unknown[]).map((id) => `<@${str(id)}>`) : [];
      return [
        kv([["Asks", [...teams.map((t) => `@${t}`), ...people].join(" ") || "nobody"], ["Access", str(args.access) === "reader" ? "Viewer" : "Editor"], ["Posts to", channel(ctx, "ops")]]),
        text("Each person who submits their email is added to the team Drive folder (and the sheet inside it) without another approval."),
        ...(args.message ? [text(blockquote(str(args.message), 600))] : []),
      ];
    }
    case "share_drive_folder":
      return [kv([["With", (Array.isArray(args.emails) ? (args.emails as unknown[]).map(str) : []).join(", ") || "none"], ["Access", str(args.access) === "reader" ? "Viewer" : "Editor"]])];
    case "log_expense":
      return expenseBlocks(args, ctx);
    case "create_event":
      return eventBlocks(args, ctx);
    case "nudge_owner":
      return [kv([["To", `<@${str(args.discordId)}>`], ["Task", str(args.taskTitle) || "none"]]), text(blockquote(str(args.message), 1200))];
    case "escalate":
      return [kv([["Posts to", channel(ctx, "ops")], ["Task", str(args.taskTitle) || "none"]]), text(blockquote(str(args.message), 1200))];
    case "escalate_to_organizer":
      return [kv([["Posts to", channel(ctx, "ops")]]), text(blockquote(str(args.question), 1200)), ...(args.context ? [text(`-# ${truncate(str(args.context), 300)}`)] : [])];
    default:
      return fallbackBlocks(args);
  }
}

function decisionLine(d: ApprovalDecision, tool: string) {
  const by = d.by ? ` by ${d.by}` : "";
  const at = d.at ? ` · ${ts(d.at)}` : "";
  const note = d.note ? `\n-# ${truncate(d.note, 300)}` : "";
  switch (d.status) {
    case "approved": return `:tether_running: **Approved**${by} · running \`${tool}\`…`;
    case "executed": return `:tether_done: **Approved**${by} · executed${at}${note}`;
    case "rejected": return `:tether_failed: **Rejected**${by}${at}${note}`;
    case "failed": return `:tether_failed: **Approved${by}, but it failed**${at}${note}`;
    case "expired": return `⌛ **Expired** without a decision${at}${note}`;
    case "cancelled": return `⏹ **Run stopped**${by} before a decision${at}${note}`;
  }
}

function editLine(e: ApprovalEdit) {
  const fields = e.fields?.length ? ` · ${e.fields.slice(0, 5).join(", ")} changed` : "";
  return `✏️ **Edited**${e.by ? ` by ${e.by}` : ""}${e.at ? ` ${ts(e.at)}` : ""}${fields}`;
}

/** Approval card (§8.3): one renderer per tool, generic key/value fallback that shows every arg. */
export function approvalCard(a: ActionRef, opts: { context?: ApprovalContext; decision?: ApprovalDecision; edited?: ApprovalEdit } = {}): Card {
  const meta = agentMeta(a.agent);
  const d = opts.decision;
  const accent = d ? DECISION_ACCENT[d.status] : meta.color;
  const gate = a.approverRole ? `risk ${a.risk} · needs ${a.approverRole}` : `risk ${a.risk}`;
  const runLink: Action[] = opts.context?.runUrl ? [{ kind: "link", url: opts.context.runUrl, label: "↩ Run" }] : [];
  const actions: Action[][] = [];
  if (!d) {
    actions.push([
      { kind: "button", id: `action:approve:${a.id}`, label: "Approve", style: "success" },
      { kind: "button", id: `action:edit:${a.id}`, label: "Edit", style: "secondary" },
      { kind: "button", id: `action:reject:${a.id}`, label: "Reject", style: "danger" },
      ...runLink,
    ]);
  } else if (runLink.length) {
    actions.push(runLink);
  }
  return {
    accent,
    title: truncate(a.summary, 200),
    subtitle: `${meta.emoji} ${meta.label} wants to run \`${a.tool}\` · ${gate}`,
    blocks: [...(d ? [text(decisionLine(d, a.tool))] : []), ...(opts.edited ? [text(editLine(opts.edited))] : []), ...bodyFor(a, opts.context)],
    actions,
    footer: `${a.effect} · action ${shortId(a.id)}`,
  };
}
