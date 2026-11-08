# Guide and live progress: `/help`, the welcome card, and watching agents work

Spec for two things the bot does not do today: explain itself, and show what an agent is doing
between step boundaries. Companion to `CARDS.md` (card states, Stop, approvals) and `DISCORD_UI.md`
(visual system). Status: **spec agreed 2026-11-07; G1 built the same day (`ui/cards/help.ts`, `/help` with topic
choices, `catalog.ts` deriving the command list from `commands.ts`, `help:topic` / `help:home`
handlers, `help_opened` events, three fixtures with payload snapshots, `help.test.ts`). G2 built the same day
(`welcomeCard` on `guildCreate`, `help:open`, pointers on the setup and channels replies). L1 built
the same day (`StepState.recent` + `toolLog`, `tool_call` events carry `stepId` and `summary`,
`refreshRunCard` reads them, `ctx.refreshStatus` after every tool call, 1.5 s edit throttle in
`DiscordNotifier`, `events_run_time_idx`). L2 built 2026-11-08 (`Notifier.typing`,
`ToolCtx.renderChannelId` from the run's thread or channel, typing before each model turn). L3 open.** Preview the cards with
`pnpm discord:preview -- help welcome status-working`.

Decisions taken: `/help` is one ephemeral card with a topic select, generated from the command
definitions so it cannot drift; progress is a per-step tool log inside the existing status card, not
token streaming. Assumed defaults, flip them here before building if you disagree: the welcome card
posts to the server's system channel; the tool log shows the last three tool calls per running step;
status edits are throttled to one per run per 1.5 s.

## 1. Problems this fixes

| # | Symptom | Cause (file) |
|---|---------|--------------|
| 1 | A new organizer types `/` and sees 10 commands and 24 subcommands with one-line descriptions; nothing says where to start or what a plan, a workflow or an approval is | No help command. The only guidance is the "Run `/tether setup`" error in `handlers.ts` |
| 2 | Nobody knows the bot reads mentions, bound channels and `/agent` threads unless they read `ARCHITECTURE.md` | Tier 1 and Tier 2 entry points (`handlers.ts onMessage`) are undocumented in Discord |
| 3 | After Run, the status card says "running" for up to a minute with nothing moving | `refreshRunCard` is called at level start, approvals posted and step finished only (`plans.ts`, `steps.ts`); the agent loop writes `tool_call` and `llm_call` events (`loop.ts`) that nothing reads live |
| 4 | In an `/agent` thread or a bound channel the only sign of life is the ⏳ reaction | Same as 3; the thread gets the status card but it is frozen between boundaries |
| 5 | A server that just added the bot gets silence | No `guildCreate` handler in `apps/server` |

## 2. What is explicitly not built

- **Token streaming.** Discord allows roughly five message edits per five seconds per channel, and
  a Components V2 card redrawn that fast flickers and drops the reader's scroll position. The
  per-tool-call log gives motion at the rate the work actually happens.
- **A reference manual inside Discord.** The card orients and names the next command to type.
  Depth stays in `docs/`.
- **Per-user onboarding state.** No "seen the guide" flags, no DMs. The welcome card is posted once
  per server join; `/help` is always a click away.

## 3. `/help`: the guide card

### 3.1 Command

`/help [topic]`. Works before `/tether setup` (the org check in `onCommand` whitelists `help`
alongside `tether`). Reply is ephemeral, so people can read it in any channel without noise.
`topic` is an optional string with choices matching §3.2; omitted opens the home topic.

### 3.2 Topics

One card, one select menu (`help:topic`), the card body swaps in place on each pick. A
`help:home` secondary button returns to the overview from any topic. Copy is markdown in
`packages/core/src/ui/cards/help.ts`; the Commands topic is rendered from a `CommandDoc[]` the
server derives from `commands.ts` at startup (name, description, subcommands, options with
required flags). Core never imports discord.js; it receives the catalog as data.

| value | Title | Body (summary of the copy) |
|-------|-------|----------------------------|
| `home` | What Tether does | Three lines: ask in plain words with an @mention and Tether proposes a plan; slash commands run one team's agent directly; nothing with a side effect happens without a card someone approves. Then "Start here": `/tether setup` → `/tether channels` → try `/plan request:…`. |
| `start` | Getting started | Setup fields (name, sheet, calendar, channels), what `/tether channels` creates (category, seven channels, five roles) and why roles matter (approvals and escalations route by them), `/tether links`, `/tether status`. |
| `commands` | Commands | Grouped by team: Finance (`/budget`), Sponsorship (`/sponsor`), Tasks (`/task`), Calendar (`/cal`), Socials (`/post`), Everything (`/plan`, `/digest`, `/workflow`, `/agent`), Admin (`/tether`). Each line: `/cmd sub` — description — required options in bold. Generated. |
| `talk` | Talking to Tether | Tier 2: @mention anywhere → plan card. Tier 1: a channel bound to an agent (`/tether bind`, or `/tether channels bind:true`) takes plain messages; `/agent` opens a thread with one agent that remembers the conversation. Attach a receipt or photos to the message and the agent sees them. Replying to a nudge in #tasks answers the nudge. |
| `plans` | Plans and approvals | The plan card: toggle steps, Edit steps, Run, Cancel; a plan nobody decides on expires after 24 hours. The status card: squares per step, Stop, Jump links. The approval card: Approve, Edit (saves, then Approve), Reject (reason), who may click (role on the card), what happens after (executed / failed / expired). |
| `workflows` | Standing workflows | What a workflow is (prebuilt plan, approved once when turned on, side effects still gated), the two in the registry with their triggers, `/workflow list`, `/workflow run`. Rendered from `workflows/registry.ts` so new workflows appear by themselves. |
| `agents` | The agents | One line per agent from `packages/core/agents/*/agent.json`: emoji, label, description, the team channel its work is reported in. Generated. |
| `roles` | Roles and permissions | Participant < Volunteer < Organizer < Finance < Lead. Unknown members count as organizers. High-risk actions need the role printed on the card; team roles created by `/tether channels` map onto these. `/tether policies` shows overrides. |

Each topic ends with a **Try it** block: one or two example commands as inline code, since a
button cannot invoke a slash command.

### 3.3 Card layout

```
┌ accent: TETHER ──────────────────────────────────┐
│ ### 📖 Tether · Commands                         │
│ Finance                                          │
│ `/budget summary [category]` — Allocated vs spent│
│ `/budget log **amount** **category** …` — …      │
│ …                                                │
│ ───                                              │
│ **Try it**  `/budget summary`  `/task list overdue:true` │
│ -# help · 2 of 8                                 │
├──────────────────────────────────────────────────┤
│ [ Pick a topic ▾ ]                               │
│ [ Home ] [ Open docs ↗ ]                         │
└──────────────────────────────────────────────────┘
```

Limits: one text display per group, each under 4000 characters, whole card under 40
components. The Commands topic is the longest; with 24 subcommands it fits in two text displays.
`Open docs` is a link button to `WEB_PUBLIC_URL/docs` when that URL is https, else omitted
(same rule as `dashboardRunUrl`).

### 3.4 Handler

`help:topic` select and `help:home` button: `i.update(await renderEdit(helpCard(topic, catalog)))`.
No database, no Inngest, no permission check. Unknown topic value falls back to `home`.

## 4. Welcome card and pointers

- **`guildCreate`**: post the `home` topic as a normal (not ephemeral) card to the system channel,
  or the first text channel the bot can send in, with a `help:open` button that replies
  ephemerally with the full guide. One post per join; nothing stored.
- **`/tether setup` and `/tether channels` replies** end with `-# Next: /help start` or
  `-# Next: /help plans` respectively.
- **"This server isn't set up yet"** gains the same pointer.
- **Status card footer** stays `run <id>`; the plan card gets no help link. The guide is one
  command away and the cards should stay quiet.

## 5. Live progress: the tool log

### 5.1 What the reader sees

Under each `running` step on the status card, up to three grey lines, newest last:

```
🟩🟦⬜  1/3 steps finished
✅ 💸 **Finance** — Log the $2k pledge on the sheet · 2 minutes ago
🔵 ✉️ **Sponsorship outreach** — Thank Shopify and book the kickoff
-# 🔎 list_sponsors · Shopify · 40s ago
-# ✉️ create_email_draft · "Welcome aboard, Shopify!" · 8s ago
-# :tether_running: thinking…
⬜ 📣 **Socials** — Announce the sponsor
```

Each line is `emoji tool · short arg · relative time`. The emoji comes from a small
`TOOL_EMOJI` map in `ui/cards/agent.ts` with the agent's emoji as fallback. The short arg is the
first string-valued argument, truncated to 40 characters; `tool.summarize(args)` is not used here
because it is written for approval cards and is too long. A failed tool call shows `⚠️` and the
error's first 60 characters. `thinking…` appears whenever the step is `running`; it is dropped
once the step is `awaiting_approval`, `done` or `failed`.

A step that is `awaiting_approval` keeps its `waiting on:` line from `CARDS.md` §10 and shows no
tool log; the Jump links already say what is happening.

### 5.2 Where the data comes from

The `events` table already has one `tool_call` row per executed tool (`loop.ts`, after
`tool.execute`) and one `llm_call` row per model turn. Two changes:

- `tool_call.data` gains `stepId` (from `ctx.stepId`) and `summary` (the short arg computed at
  write time, so the card never re-derives it from raw args), and keeps `tool`, `args`, `error`.
- `refreshRunCard` (`runtime/status.ts`) selects the last three `tool_call` events per running
  step for the run, ordered by `time`, and passes them to `statusCard` as
  `StepState.recent: ToolLogLine[]` where `ToolLogLine = { tool, summary?, at, error? }`.

No new table, no new column. Events are a Tiger hypertable indexed on `(org_id, time)`; the query
is bounded by `run_id` and `kind = 'tool_call'` and touches a few dozen rows.

### 5.3 When the card redraws

- After every `tool_call` insert in `loop.ts`: `await ctx.refreshStatus?.()`. `ToolCtx` gains an
  optional `refreshStatus: () => Promise<void>`; `buildToolCtx` wires it to
  `refreshRunCard(runId, notifier)` with the same `.catch(console.warn)` the Inngest functions use.
  The call sits inside the existing `step.run` for the tool, so Inngest's memoization means a retried
  step does not redraw twice.
- Existing boundary refreshes in `plans.ts` and `steps.ts` stay.
- **Throttle** in `DiscordNotifier.updateStatus`: one in-flight edit per run id, at most one per
  1.5 s, trailing call always applied. Two parallel steps each making a tool call in the same second
  produce one edit that shows both, because both read from the rows. The throttle is in the adapter,
  not core, because it exists only for Discord's rate limit.

### 5.4 Typing indicator

`Notifier` gains `typing(input: { channelId: string }): Promise<void>`; the Discord adapter calls
`channel.sendTyping()` and swallows errors. `loop.ts` calls `ctx.notify.typing` with the run's
render target before each Gemini call. The indicator lasts ten seconds, about one model turn, and
costs no message. `ToolCtx` gains `renderChannelId?: string` (thread id when the run lives in a
thread, else the channel the status card is in) so the loop knows where to type.

### 5.5 Tier 1 threads and bound channels

Nothing extra. A thread run's `source.threadId` already puts the status card in the thread, so the
tool log and typing indicator appear there. When the step finishes, the ⏳ reaction on the
triggering message is swapped for ✅ (or ❌ on failure) in `steps.ts finish-step` via a new
`Notifier.react(input: { channelId, messageId, emoji, remove?: string })`. This is the only new
behaviour for Tier 1 and it is optional (L3).

## 6. Schema, events and ids

- **Schema:** no changes.
- **Events:** `tool_call.data` += `stepId`, `summary`. New kind `help_opened` with
  `{ topic, discordId }` so the dashboard can see which topics people read; written on `/help` and on
  every topic pick. No other new kinds.
- **Interaction ids:** `help:topic` (select, values from §3.2), `help:home` (button),
  `help:open` (button on the welcome card). All ephemeral, no permission checks.
- **Notifier:** `typing`, `react` (L3). `ToolCtx`: `refreshStatus?`, `renderChannelId?`.

## 7. Work plan

| Phase | Scope | Files | Depends on |
|-------|-------|-------|------------|
| G1 | `helpCard(topic, catalog)` with all eight topics, `CommandDoc` derivation from `commands.ts`, `/help` command and handler, `help_opened` event, fixtures `help-home`, `help-commands`, `help-plans` | `core/src/ui/cards/help.ts`, `core/src/ui/fixtures.ts`, `server/src/discord/commands.ts`, `handlers.ts` | — |
| G2 | `guildCreate` welcome post, `help:open`, pointers on setup/channels/not-set-up replies | `server/src/discord/client.ts`, `handlers.ts` | G1 |
| L1 | `ToolLogLine` on `StepState`, tool log rendering, `tool_call` event fields, `refreshRunCard` query, `ctx.refreshStatus` hook, adapter throttle, fixture `status-working` | `core/src/ui/cards/status.ts`, `runtime/status.ts`, `runtime/loop.ts`, `runtime/context.ts`, `tools/types.ts`, `server/src/discord/notifier.ts` | the test-harness session must finish first: it edits `runtime/status.ts` |
| L2 | `Notifier.typing`, `renderChannelId`, typing before each model turn | `tools/types.ts`, `runtime/context.ts`, `runtime/loop.ts`, `notifier.ts` | L1 (shares `ToolCtx` edits) |
| L3 | Reaction swap on the triggering message when a Tier 1 step finishes | `tools/types.ts`, `notifier.ts`, `inngest/functions/steps.ts` | L2 |

G1 and L1 touch different files and can run in parallel. `handlers.ts` is edited only by G1 and G2.

## 8. Verification

Automated (snapshot tests from the harness session pick these up once the fixtures exist):
- `help-home`, `help-commands`, `help-plans`, `status-working` render under the component and text
  limits; the Commands topic lists every subcommand in `commands.ts` (a unit test diffs the catalog
  against the generated text).
- `statusCard` with `recent` lines shows at most three per step, newest last, and none on a step
  that is `awaiting_approval`.
- `refreshRunCard` query returns only `tool_call` rows for the run, grouped by `stepId`.

In the dev guild:
- `/help` before setup works; after setup every topic swaps in place; `Home` returns; the select keeps
  the picked topic as its default.
- Kick and re-add the bot: the welcome card lands in the system channel and `help:open` replies
  ephemerally.
- Run the demo plan (`ARCHITECTURE.md` §Demo scripts): the Sponsorship step shows `list_sponsors`
  then `create_email_draft` within a few seconds of each call; the typing indicator shows in the
  channel before each turn; the finished step drops its log and keeps its timestamp.
- `/agent name:finance request:what's left in Food?` in a channel: the thread shows the status card
  with a tool log, then the reply; the ⏳ on the message becomes ✅ (L3).
- Two parallel steps: watch the edit count in the server log stay under one per 1.5 s per run.
