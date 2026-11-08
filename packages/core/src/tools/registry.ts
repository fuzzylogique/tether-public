import type { Tool } from "./types.js";
import { financeTools } from "./finance.js";
import { outreachTools } from "./outreach.js";
import { calendarTools } from "./calendar.js";
import { coordinationTools } from "./coordination.js";
import { socialsTools } from "./socials.js";
import { helpdeskTools } from "./helpdesk.js";
import { accessTools } from "./access.js";

/** Fixed registry. Agents enable tools by name; they can never define new ones. */
export const ALL_TOOLS: Tool[] = [
  ...financeTools, ...outreachTools, ...calendarTools, ...coordinationTools, ...socialsTools, ...helpdeskTools, ...accessTools,
] as unknown as Tool[];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): Tool | undefined {
  return byName.get(name);
}

export function resolveTools(names: string[]): Tool[] {
  return names.map((n) => {
    const t = byName.get(n);
    if (!t) throw new Error(`unknown tool: ${n}`);
    return t;
  });
}
