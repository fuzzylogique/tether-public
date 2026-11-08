import { agents } from "../../agents/registry.js";
import { AGENT_CHANNEL } from "../../runtime/feed.js";
import { WORKFLOWS } from "../../workflows/registry.js";
import { TETHER } from "../tokens.js";
import { sep, text, type Action, type Card } from "../card.js";
import { agentMeta } from "./agent.js";

/**
 * The `/help` guide card (docs/GUIDE.md §3): one ephemeral card, a topic select, and bodies that
 * swap in place. Concept topics are copy kept here; the Commands, Agents and Workflows topics are
 * rendered from the registries (and the command catalog the adapter passes in) so they cannot drift.
 */

/** A registered slash command as data, so core never imports discord.js. */
export type CommandDoc = {
  name: string;
  description: string;
  /** One entry per subcommand; a command with no subcommands has one entry with `name` undefined. */
  subcommands: { name?: string; description: string; options: { name: string; description: string; required: boolean }[] }[];
};

export const HELP_TOPICS = [
  { value: "home", label: "What Tether does", description: "Overview and where to start", emoji: "📖" },
  { value: "start", label: "Getting started", description: "Setup, team channels, roles", emoji: "🚀" },
  { value: "commands", label: "Commands", description: "Every slash command, by team", emoji: "⌨️" },
  { value: "talk", label: "Talking to Tether", description: "Mentions, bound channels, threads", emoji: "💬" },
  { value: "plans", label: "Plans and approvals", description: "The cards and their buttons", emoji: "🗂️" },
  { value: "workflows", label: "Standing workflows", description: "Prebuilt plans that fire on events", emoji: "⚙️" },
  { value: "agents", label: "The agents", description: "Who does what", emoji: "🤖" },
  { value: "roles", label: "Roles and permissions", description: "Who may approve what", emoji: "🔑" },
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number]["value"];

export function isHelpTopic(v: string | undefined): v is HelpTopic {
  return HELP_TOPICS.some((t) => t.value === v);
}

/** Command groups in display order; anything unlisted lands under "Other". */
const GROUPS: [title: string, commands: string[]][] = [
  ["Finance", ["budget"]],
  ["Sponsorship", ["sponsor"]],
  ["Tasks", ["task"]],
  ["Calendar", ["cal"]],
  ["Socials", ["post"]],
  ["Any team", ["plan", "digest", "workflow", "agent"]],
  ["Admin", ["tether", "help"]],
];

function commandLine(cmd: CommandDoc, sub: CommandDoc["subcommands"][number]) {
  const head = `\`/${cmd.name}${sub.name ? ` ${sub.name}` : ""}\``;
  const opts = sub.options.map((o) => (o.required ? `**${o.name}**` : `[${o.name}]`)).join(" ");
  return `${head}${opts ? ` ${opts}` : ""} — ${sub.description}`;
}

/** The Commands topic as markdown groups; exported so the adapter can test it against the live catalog. */
export function commandGroups(commands: CommandDoc[]): { title: string; lines: string[] }[] {
  const byName = new Map(commands.map((c) => [c.name, c]));
  const used = new Set<string>();
  const out: { title: string; lines: string[] }[] = [];
  for (const [title, names] of GROUPS) {
    const lines = names.flatMap((n) => { const c = byName.get(n); if (!c) return []; used.add(n); return c.subcommands.map((s) => commandLine(c, s)); });
    if (lines.length) out.push({ title, lines });
  }
  const rest = commands.filter((c) => !used.has(c.name)).flatMap((c) => c.subcommands.map((s) => commandLine(c, s)));
  if (rest.length) out.push({ title: "Other", lines: rest });
  return out;
}

const tryIt = (...examples: string[]) => `**Try it**  ${examples.map((e) => `\`${e}\``).join("  ")}`;

function home(): string[] {
  return [
    [
      "### 📖 Tether",
      "Tether runs your event's operations from this server. Six agents (finance, sponsorship, tasks, calendar, socials, helpdesk) do the work; you approve anything that spends money, sends email or posts publicly.",
      "",
      "**Three ways to ask**",
      "• **@mention Tether** anywhere, in plain words → it proposes a plan you can edit and run.",
      "• **A slash command** runs one team's agent right away, e.g. `/budget summary`.",
      "• **`/agent`** opens a thread with one agent that remembers the conversation.",
      "",
      "**Nothing happens behind your back.** Every side effect is a card with Approve, Edit and Reject. A running plan has a Stop button on its status card.",
    ].join("\n"),
    [
      "**Start here**",
      "1. `/tether setup name:… sheet_id:… calendar_id:…`",
      "2. `/tether channels` → team channels and roles",
      "3. `/plan request:Shopify confirmed $2k, kick off onboarding`",
      "",
      "-# Pick a topic below for more.",
    ].join("\n"),
  ];
}

function start(): string[] {
  return [
    [
      "### 🚀 Getting started",
      "**1. `/tether setup`** — name the event and connect the shared Google Sheet (budget, sponsors, tasks) and Calendar. Optional: which channels are ops, announcements, sponsorship and photos.",
      "",
      "**2. `/tether channels`** — creates a **Tether** category with #ops, #tasks, #calendar, #finance, #sponsorship, #socials and #photos, plus five roles: Lead, Finance, Sponsorship, Socials, Logistics. Assign people to the roles: approvals and escalations are routed by them. Add `bind:true` so plain messages in a team channel go straight to that team's agent.",
      "",
      "**3. Check the wiring** — `/tether links` shows the shared calendar, sheet and Drive folder; `/tether status` lists recent runs; `/tether policies` shows what asks for approval.",
      "",
      "**4. Try a plan** — `/plan request:…`, or @mention Tether in any channel.",
    ].join("\n"),
    tryIt("/tether links", "/tether status"),
  ];
}

function commands(catalog: CommandDoc[]): string[] {
  const groups = commandGroups(catalog);
  // Two text displays so the longest topic stays well under Discord's 4000-character limit each.
  const half = Math.ceil(groups.length / 2);
  const block = (gs: typeof groups) => gs.map((g) => `**${g.title}**\n${g.lines.join("\n")}`).join("\n\n");
  return [
    `### ⌨️ Commands\n**bold** options are required, [bracketed] ones optional.\n\n${block(groups.slice(0, half))}`,
    block(groups.slice(half)),
    tryIt("/budget summary", "/task list overdue:true", "/cal today"),
  ];
}

function talk(): string[] {
  return [
    [
      "### 💬 Talking to Tether",
      "**@mention anywhere** — \"@Tether Shopify confirmed $2k, kick off onboarding\" → a plan card in that channel. `/plan from_chat:40` plans from the last 40 messages of a discussion instead.",
      "",
      "**Bound channels** — after `/tether channels bind:true` (or `/tether bind channel:#finance agent:finance`) every plain message in that channel goes to its agent. No mention needed.",
      "",
      "**Threads** — `/agent name:finance request:…` opens a thread with one agent that keeps the conversation's context. Reply in the thread to continue.",
      "",
      "**Attachments** — a receipt on `/budget receipt`, or photos on a message in a bound channel, are read by the agent. Recap posts pick photos from #photos.",
      "",
      "**Nudges** — when Tether nudges you about an overdue task in #tasks, reply to that message or DM the bot. \"Done\", \"Friday\" and \"can't\" are all understood.",
    ].join("\n"),
    tryIt("/agent name:finance request:what's left in Food?", "/plan from_chat:40"),
  ];
}

function plans(): string[] {
  return [
    [
      "### 🗂️ Plans and approvals",
      "**Plan card** — the steps Tether proposes, one per agent. Toggle steps on or off, **Edit steps** to reword an instruction, **Run** to start, **Cancel** to drop it. Whoever asked, or any organizer, may decide. An undecided plan expires after 24 hours.",
      "",
      "**Status card** — one square per step: :tether_pending: pending, :tether_running: running, :tether_done: done, :tether_failed: failed, ⬛ stopped. **Stop** ends the run after the current tool call; nothing new starts. **Jump** links open any approval the run is waiting on.",
      "",
      "**Approval card** — posted in the owning team's channel when a step wants to spend, send or post. **Approve** runs it. **Edit** opens the fields (recipient, amount, caption…) and saves; the card stays pending so you can Approve the edited version. **Reject** takes an optional reason and the agent continues without that action. The card names the role it needs. It updates itself when the run has moved on, and expires after 24 hours.",
      "",
      "**Summary card** — what each step produced, and which approved actions actually ran.",
    ].join("\n"),
    tryIt("/plan request:Book the judge briefing for Saturday 9am and tell the team"),
  ];
}

function workflows(): string[] {
  const lines = Object.values(WORKFLOWS).map((w) => `⚙️ **${w.label}** — ${w.description}\n-# fires ${w.trigger} · renders in #${w.channel}`);
  return [
    [
      "### ⚙️ Standing workflows",
      "A workflow is a prebuilt plan that fires on an event instead of a request. It was approved when the org turned it on, so no plan card is posted, but every side effect inside still goes through the same approval cards.",
      "",
      ...lines,
    ].join("\n"),
    tryIt("/workflow list", "/workflow run name:sponsor-confirmed sponsor:Shopify amount:2000"),
  ];
}

function agentList(): string[] {
  const lines = Object.values(agents()).map((a) => {
    const m = agentMeta(a.name);
    const channel = AGENT_CHANNEL[a.name];
    return `${m.emoji} **${m.label}** — ${a.description}${channel ? `\n-# reports in #${channel}` : ""}`;
  });
  return [
    ["### 🤖 The agents", "Each agent has its own tools and its own team channel. A plan picks the agents it needs; a slash command or a bound channel talks to one directly.", "", ...lines].join("\n"),
    tryIt("/agent name:socials request:draft a thank-you post for our sponsors"),
  ];
}

function roles(): string[] {
  return [
    [
      "### 🔑 Roles and permissions",
      "Ranks, lowest to highest: **participant** → **volunteer** → **organizer** → **finance** → **lead**. Server members Tether has no record of count as organizers.",
      "",
      "**Who approves what** — reads and low-risk writes just run. Medium-risk actions (announcements, calendar events, expense entries, nudges) ask any organizer. High-risk actions (outgoing email, Instagram posts, escalations) ask a **Lead**; the approval card says which.",
      "",
      "**Team roles** — of the Discord roles `/tether channels` creates, **Lead** and **Finance** carry those ranks. Sponsorship, Socials and Logistics decide where cards and escalations go, not who may click them.",
      "",
      "**Policies** — `/tether policies` lists this server's overrides to the defaults.",
    ].join("\n"),
    tryIt("/tether policies"),
  ];
}

const BODIES: Record<HelpTopic, (catalog: CommandDoc[]) => string[]> = {
  home: () => home(), start: () => start(), commands, talk: () => talk(), plans: () => plans(), workflows: () => workflows(), agents: () => agentList(), roles: () => roles(),
};

/**
 * Posted once when the bot joins a server (docs/GUIDE.md §4): the home topic without the select, since
 * a public card must not swap under everyone, plus a button that opens the full guide ephemerally.
 */
export function welcomeCard(input: { docsUrl?: string }): Card {
  return {
    accent: TETHER,
    blocks: home().map(text),
    actions: [[
      { kind: "button", id: "help:open", label: "Open the guide", style: "primary" },
      ...(input.docsUrl ? [{ kind: "link", url: input.docsUrl, label: "Open docs" } as Action] : []),
    ]],
    footer: "Tether · /help any time",
  };
}

export function helpCard(topic: HelpTopic, input: { commands: CommandDoc[]; docsUrl?: string }): Card {
  const index = HELP_TOPICS.findIndex((t) => t.value === topic);
  const paragraphs = BODIES[topic](input.commands);
  const blocks = paragraphs.flatMap((md, i) => (i === paragraphs.length - 1 && paragraphs.length > 1 ? [sep(), text(md)] : [text(md)]));
  const select: Action = {
    kind: "select", id: "help:topic", placeholder: "Pick a topic", min: 1, max: 1,
    options: HELP_TOPICS.map((t) => ({ label: t.label, value: t.value, description: t.description, default: t.value === topic })),
  };
  const row: Action[] = [
    ...(topic !== "home" ? [{ kind: "button", id: "help:home", label: "Home", style: "secondary" } as Action] : []),
    ...(input.docsUrl ? [{ kind: "link", url: input.docsUrl, label: "Open docs" } as Action] : []),
  ];
  return {
    accent: TETHER,
    blocks,
    actions: [[select], row].filter((r) => r.length),
    footer: `help · ${index + 1} of ${HELP_TOPICS.length}`,
  };
}
