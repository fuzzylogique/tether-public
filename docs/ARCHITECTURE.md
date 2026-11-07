# Tether architecture

## One sentence
Durable, human-curated agent workflows for event operations, with Discord as the primary adapter and a web dashboard for oversight.

## Pipeline
1. Entry: slash command (Tier 0), mention or bound-channel message (Tier 1), watcher/cron (automated).
2. Discord gateway converts the interaction into an Inngest event and acks within 3s.
3. `tether/request.received` → orchestrator drafts a **plan** (structured output: steps, agent, instruction, dependsOn, needsApproval). Slash commands skip this and emit a prebuilt one-step plan.
4. Plan card in Discord (toggle/edit/approve) unless the plan is one low-risk step → `plan/decided`.
5. Executor runs dependency levels in parallel; each step invokes `run-agent-step`.
6. Agent loop (resumable) → tool call → `policy.decide()` → run / approval card / deny.
7. Approval card → `action/decided` → tool executes → agent resumes with the result.
8. Status embed edited in place; run recorded in `runs`, `steps`, `actions` (hypertables on Tiger).

### Where things render
`/tether channels` creates a **Tether** category with one channel per team (ops, tasks, calendar, finance, sponsorship, socials, photos), one Discord role per team (Lead, Finance, Sponsorship, Socials, Logistics; `orgs.roles`), and optionally binds each channel to its agent (`bind:true`). After that:
- A single-agent run (slash command, cron, watcher) renders its status and summary in **that team's channel** (`teamChannelFor`); the channel the command was typed in only gets a pointer. Plans (`mode: auto`) stay where they were asked for, because the people in that conversation review them.
- Approval cards go to the channel of the team that owns the decision (a finance step's card lands in #finance even when the plan runs in #sponsorship), unless the run lives in a thread.
- Executed side effects are mirrored as one activity line into the owning team's channel (`runtime/feed.ts`).
- Escalations ping the Lead role in #ops.

### Nudge loop (coordination)
`monitor-tasks` claims an overdue task with one conditional UPDATE that also bumps `nudge_count` and flips `escalated` once the count passes `ESCALATE_AFTER_NUDGES`; the agent only writes the message. An owner's answer, a DM to the bot or a reply to the nudge in #tasks, is a `tether/nudge.replied` event: `handle-nudge-reply` classifies it with one structured Gemini call (eta / done / cannot / question / other), moves the due date or status, acknowledges where they replied, and posts a one-liner to #tasks. "Can't" marks the task blocked and pings the Lead to reassign right away. A moved due date or a new owner resets the cycle.

### Plan from a discussion
`/plan from_chat:40` reads the last N human messages in the channel, hands them to the orchestrator as `context`, and posts the normal plan card for review. The planner is told the transcript is data and that the plan is the decisions and open action items, not the chatter.

### Standing workflows
`workflows/registry.ts` holds prebuilt DAGs that fire on an event instead of an organizer's request (`tether/workflow.triggered` → `run-workflow` → `run-plan`). They are approved once, when the org turns them on, so no plan card is posted; every side effect inside still goes through `policy.decide()`. `update_sponsor` fires `sponsor-confirmed` on the transition into confirmed, whoever moved the stage (the mail watcher's agent run or a human): pledged income on the sheet (approval card in #finance), deliverable tasks, welcome announcement (approval). `/workflow run` fires one by hand; `/workflow list` shows them.

### Inbox digest
`inbox-digest` (cron `DIGEST_CRON`) and `/digest hours:24` pull the organizer inbox since the window start, summarize it in one structured Gemini call (needs-action first, then FYI), and post a card to #ops. Emails are untrusted data to the model. Sponsor replies keep their own watcher.

## Agents
finance, outreach, socials, calendar, coordination, helpdesk, builder (stretch). Each is `agents/<name>/agent.json` + `prompt.md`.

## Policy
`policies` table: (org, tool, condition, decision). Defaults in `policy/defaults.ts`. Loosening requires the lead role.

## Data
Tiger Cloud Postgres. `events` is a hypertable with the `agent_activity_hourly` continuous aggregate on top. `documents` uses pgvector + pg_textsearch hybrid search. Mirror tables: `budget_lines`, `expenses`, `income`, `sponsors`, `sponsor_threads`, `tasks`, `calendar_events`.

### Finance sheet
`pnpm sheet:create` builds (or upgrades) the org Google Sheet from the mirror; re-running it adds missing tabs and rewrites headers and formulas.
- `Budget`: Category, Allocated.
- `Expenses`: Date, Category, Amount (total incl. tax), Vendor, Description, Receipt (Vultr Object Storage URL), Logged by, Tax, Paid by, Reimbursement (`pending`/`paid`). Columns are only ever appended so older sheets keep syncing.
- `Income`: Date, Source, Amount, Status (`pledged`/`invoiced`/`received`), Notes. Sponsor money goes here via `log_income`, never into Expenses.
- `Summary`: formulas only (per-category spend, totals, HST paid, income, net position, reimbursements owed per person). Organizers can edit the data tabs by hand and `sync_budget_from_sheet` validates every cell before replacing the mirror in one transaction.

**Schema push on the shared DB.** The Drizzle schema (`packages/core/src/db/schema.ts`) owns tables, columns, foreign keys and indexes; `packages/core/sql/tiger.sql` owns everything Timescale-specific (extensions, `create_hypertable`, the continuous aggregate and its refresh policy, the HNSW and BM25 indexes). `pnpm db:push` runs `tiger.sql`'s extension block, then `src/db/push.ts`, then the rest of `tiger.sql`. Rules that keep the two from fighting:
- Timescale objects are declared in the Drizzle schema so drizzle-kit sees them as already present instead of "unknown, drop it": the continuous aggregate is a `pgView(...).existing()` (Postgres reports a continuous aggregate as a plain view, and `DROP VIEW` on one is an error), `events_time_idx` (created by `create_hypertable`) and `documents_bm25_idx` are declared as indexes. On a fresh DB drizzle creates `events_time_idx` first and `create_hypertable` skips its default index.
- `src/db/push.ts` replaces `drizzle-kit push`, which exits 0 on a failed statement. It plans through drizzle-kit's API, refuses to run at all if the plan touches a protected object (`PROTECTED_OBJECTS` in `src/db/drizzleFilters.ts`), holds back destructive statements (DROP, DROP COLUMN, type changes, TRUNCATE) unless `--allow-destructive` is passed, and exits 1 listing any statement that failed. `pnpm db:plan` prints the plan without executing. Because the DB is shared between branches, destructive statements usually mean "another branch's columns", not drift to fix.
- `events` has no foreign keys on purpose: chunks are dropped by retention and the stream must never block a run.

## Infra
Vultr VM → Docker Compose (server, web, caddy). Inngest Cloud. Auth0 for dashboard + roles. Single organizer Google account (refresh token). GoDaddy domain → Caddy.

## Demo scripts
1. Receipt photo → finance logs expense, budget status.
2. "Shopify confirmed $2k, kick off onboarding" → plan card → untick one step → run → emails await approval → calendar + sheet + post update.
3. Overdue task → nudge in #tasks (or DM) → owner replies "tomorrow 3pm" → due date moves, team sees it → or "can't" → blocked, Lead pinged to reassign → or silence → escalate to lead after two nudges.
3b. `/plan from_chat:40` in a channel where the team just argued about the closing ceremony → plan card of what was decided → approve.
3c. `/workflow run sponsor-confirmed sponsor:Shopify amount:2000 tier:Gold` (or the outreach agent moving Shopify to confirmed) → income entry awaiting approval in #sponsorship, deliverable tasks, welcome post awaiting approval.
3d. `/digest hours:24` → inbox card: what needs a reply, what is FYI.
4. `/post recap` → socials lists the photos the team dropped in `#photos` → Gemini vision picks the best four with captions and stores durable copies in Object Storage → copy written to match → approval card showing all four → announcement. Hero image generation is the fallback when there is nothing to photograph yet, and it skips gracefully on a free-tier key.

## Team seams
A: engine, planner, gateway (core/runtime). B: tools, mirror, watchers (core/tools, core/google). C: web + Auth0. D: Discord adapter, seed data, demo.

## Stretch, in order
calendar + socials polish, receipt vision, Token Vault, CIBA, helpdesk RAG, builder agent + Entire external agent, Tiger forks for dry runs.
