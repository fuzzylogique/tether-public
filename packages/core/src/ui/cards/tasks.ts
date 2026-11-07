import { AGENT_COLORS, GREEN, RED, TETHER } from "../tokens.js";
import { mention, text, ts, type Block, type Card } from "../card.js";

export type TaskRow = {
  id?: string; title: string; status: string; ownerName: string | null; ownerDiscordId: string | null;
  dueAt: Date | string | null; overdue: boolean; avatarUrl?: string;
};

const STATUS = [
  { key: "todo", label: "To do", color: TETHER },
  { key: "in_progress", label: "In progress", color: AGENT_COLORS.coordination! },
  { key: "blocked", label: "Blocked", color: RED },
  { key: "done", label: "Done", color: GREEN },
];

/** Past this many task sections the 40-component budget runs out; the rest become one text list. */
const MAX_SECTIONS = 6;

/** `/task list` (§8.6): status bar, then Overdue / Today / Later with owner avatars. */
export function tasksCard(input: { tasks: TaskRow[]; now?: number; overdueOnly?: boolean }): Card {
  const now = input.now ?? Date.now();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const due = (t: TaskRow) => (t.dueAt ? new Date(t.dueAt).getTime() : Infinity);
  const open = input.tasks.filter((t) => t.status !== "done").sort((a, b) => due(a) - due(b));
  const groups: [string, TaskRow[]][] = [
    ["🔴 Overdue", open.filter((t) => t.overdue)],
    ["🟠 Due today", open.filter((t) => !t.overdue && due(t) <= endOfDay.getTime())],
    ["Later", open.filter((t) => !t.overdue && due(t) > endOfDay.getTime())],
  ];

  const blocks: Block[] = [];
  if (!input.tasks.length) blocks.push(text(input.overdueOnly ? "Nothing overdue. 🎉" : "No tasks."));
  else {
    if (!input.overdueOnly) {
      blocks.push({
        kind: "chart", name: "task-status", alt: STATUS.map((s) => `${s.label} ${input.tasks.filter((t) => t.status === s.key).length}`).join(", "),
        spec: { type: "stacked", segments: STATUS.map((s) => ({ label: s.label, value: input.tasks.filter((t) => t.status === s.key).length, color: s.color })) },
      });
    }
    let sections = 0;
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      blocks.push(text(`### ${label} · ${rows.length}`));
      const overflow: string[] = [];
      for (const t of rows) {
        const owner = mention(t.ownerDiscordId, t.ownerName ?? "unassigned");
        const when = t.dueAt ? `${t.overdue ? "was due" : "due"} ${ts(t.dueAt)}` : "no due date";
        const status = t.status === "blocked" ? " · ⛔ blocked" : t.status === "in_progress" ? " · in progress" : "";
        if (sections < MAX_SECTIONS) {
          blocks.push({ kind: "section", md: [`**${t.title}**`, `-# ${owner} · ${when}${status}`], thumb: t.avatarUrl ? { url: t.avatarUrl, alt: t.ownerName ?? "owner" } : undefined });
          sections++;
        } else overflow.push(`• **${t.title}** · ${owner} · ${when}`);
      }
      if (overflow.length) blocks.push(text(overflow.join("\n")));
    }
    const done = input.tasks.filter((t) => t.status === "done").length;
    if (done && !input.overdueOnly) blocks.push(text(`-# ✅ ${done} done`));
  }
  const overdue = input.tasks.filter((t) => t.overdue).length;
  return {
    accent: overdue ? RED : AGENT_COLORS.coordination,
    title: input.overdueOnly ? "Overdue tasks" : "Tasks",
    subtitle: `${open.length} open · ${overdue} overdue`,
    blocks,
  };
}
