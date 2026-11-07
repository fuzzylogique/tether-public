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

## Agents
finance, outreach, socials, calendar, coordination, helpdesk, builder (stretch). Each is `agents/<name>/agent.json` + `prompt.md`.

## Policy
`policies` table: (org, tool, condition, decision). Defaults in `policy/defaults.ts`. Loosening requires the lead role.

## Data
Tiger Cloud Postgres. `events` is a hypertable with the `agent_activity_hourly` continuous aggregate on top. `documents` uses pgvector + pg_textsearch hybrid search. Mirror tables: `budget_lines`, `expenses`, `sponsors`, `sponsor_threads`, `tasks`, `calendar_events`.

**Schema push on the shared DB.** The Drizzle schema (`packages/core/src/db/schema.ts`) owns tables, columns, foreign keys and indexes; `packages/core/sql/tiger.sql` owns everything Timescale-specific (extensions, `create_hypertable`, the continuous aggregate and its refresh policy, the HNSW and BM25 indexes). `pnpm db:push` runs `tiger.sql`'s extension block, then `src/db/push.ts`, then the rest of `tiger.sql`. Rules that keep the two from fighting:
- Timescale objects are declared in the Drizzle schema so drizzle-kit sees them as already present instead of "unknown, drop it": the continuous aggregate is a `pgView(...).existing()` (Postgres reports a continuous aggregate as a plain view, and `DROP VIEW` on one is an error), `events_time_idx` (created by `create_hypertable`) and `documents_bm25_idx` are declared as indexes. On a fresh DB drizzle creates `events_time_idx` first and `create_hypertable` skips its default index.
- `src/db/push.ts` replaces `drizzle-kit push`, which exits 0 on a failed statement. It plans through drizzle-kit's API, refuses to run at all if the plan touches a protected object (`PROTECTED_OBJECTS` in `src/db/drizzleFilters.ts`), holds back destructive statements (DROP, DROP COLUMN, type changes, TRUNCATE) unless `--allow-destructive` is passed, and exits 1 listing any statement that failed. `pnpm db:plan` prints the plan without executing. Because the DB is shared between branches, destructive statements usually mean "another branch's columns", not drift to fix.
- `events` has no foreign keys on purpose: chunks are dropped by retention and the stream must never block a run.

## Infra
Vultr VM → Docker Compose (server, web, caddy). Inngest Cloud. Auth0 for dashboard + roles. Single organizer Google account (refresh token). GoDaddy domain → Caddy.

## Demo scripts
1. Receipt photo → finance logs expense, budget status.
2. "Shopify confirmed $2k, kick off onboarding" → plan card → untick one step → run → emails await approval → calendar + sheet + post update.
3. Overdue task → nudge DM → no response → escalate to lead.

## Team seams
A: engine, planner, gateway (core/runtime). B: tools, mirror, watchers (core/tools, core/google). C: web + Auth0. D: Discord adapter, seed data, demo.

## Stretch, in order
calendar + socials polish, receipt vision, Token Vault, CIBA, helpdesk RAG, builder agent + Entire external agent, Tiger forks for dry runs.
