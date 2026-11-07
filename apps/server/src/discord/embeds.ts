import { EmbedBuilder } from "discord.js";
import { agents, type Plan } from "@tether/core";

export const TETHER_COLOR = 0x6d5df6;

export function agentColor(name: string) {
  const hex = agents()[name]?.color ?? "#6D5DF6";
  return parseInt(hex.replace("#", ""), 16);
}

export function planEmbed(runId: string, request: string, plan: Plan, status = "Proposed") {
  const lines = plan.steps.map((s, i) => {
    const a = agents()[s.agent];
    const box = s.enabled ? "☑" : "☐";
    const deps = s.dependsOn.length ? ` _(after ${s.dependsOn.join(", ")})_` : "";
    const gate = s.needsApproval ? " 🔒" : "";
    return `${box} **${i + 1}. ${a?.label ?? s.agent}**${gate}${deps}\n　${s.instruction}`;
  });
  return new EmbedBuilder()
    .setColor(TETHER_COLOR)
    .setTitle(`Plan · ${plan.summary}`)
    .setDescription(`> ${request.slice(0, 300)}\n\n${lines.join("\n")}`)
    .setFooter({ text: `${status} · run ${runId.slice(0, 8)} · untick steps you don't want, then Run` });
}

export function statusEmbed(runId: string, request: string, lines: string[], status: string) {
  const colors: Record<string, number> = { running: 0xef9f27, done: 0x1d9e75, failed: 0xe24b4a, cancelled: 0x888780 };
  return new EmbedBuilder()
    .setColor(colors[status] ?? TETHER_COLOR)
    .setTitle(status === "done" ? "Done" : status === "failed" ? "Failed" : status === "cancelled" ? "Cancelled" : "Working…")
    .setDescription(`> ${request.slice(0, 200)}\n\n${lines.join("\n")}`)
    .setFooter({ text: `run ${runId.slice(0, 8)}` });
}

export function approvalEmbed(a: { id: string; agent: string; tool: string; summary: string; risk: string; args: Record<string, unknown> }) {
  const label = agents()[a.agent]?.label ?? a.agent;
  const detail = a.tool === "send_email"
    ? `**To:** ${a.args.to}\n**Subject:** ${a.args.subject}\n\n${String(a.args.body ?? "").slice(0, 1500)}`
    : "```json\n" + JSON.stringify(a.args, null, 2).slice(0, 1500) + "\n```";
  return new EmbedBuilder()
    .setColor(agentColor(a.agent))
    .setTitle(`${label} wants to: ${a.summary}`)
    .setDescription(detail)
    .setFooter({ text: `risk ${a.risk} · ${a.tool} · action ${a.id.slice(0, 8)}` });
}

export function resultEmbed(agent: string, title: string, body: string) {
  return new EmbedBuilder().setColor(agentColor(agent)).setTitle(title).setDescription(body.slice(0, 4000));
}
