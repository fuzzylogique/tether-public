# Tether — teammate onboarding (Sat Nov 7)

Read this top to bottom. 10 minutes to a running local stack.

## 0. What is already true
- The whole pipeline is **verified live**: Discord request → Inngest → plan card → executor → agent loop → policy gateway → approval card → Gmail send → summary. See `docs/ARCHITECTURE.md` for the design and the three demo scripts.
- Dev Discord server is **vibe club** (bot `tether#8659` is in it, slash commands registered). All agent output goes to **#general** for now.
- Database is a shared **Tiger Cloud** service, already pushed and seeded (budget, 4 sponsors, 3 tasks, FAQ docs, policies). You do **not** run `db:push` or `db:seed` again unless you change the schema (the `processed_mail` table from the cron-monitor fix needs one `pnpm db:push` by whoever owns the DB).
- A Google Sheet "HackTrent 2026 · Tether" with Budget/Expenses/Sponsors/Tasks tabs lives in Fayez's Drive and is bound to the org, as is his primary calendar.
- Google Cloud billing is **disabled** on both Tether projects. Gemini runs on the free tier. Nothing can be charged.

## 1. Get the secrets (not in git)
Ask Fayez for the `.env` file (Discord DM or a password manager). It contains: Discord bot token, Gemini key, Tiger `DATABASE_URL`, Google OAuth client + refresh token. **Never commit it, never paste it in a channel.** Put it at the repo root as `.env`.

## 2. Install
```bash
git clone <repo url> tether && cd tether
brew install --cask entireio/tap/entire      # once per machine
entire enable --agent claude-code            # once per clone (records your agent sessions as checkpoints)
npm i -g pnpm
pnpm install
pnpm env:check                               # every line should be ✔ or –, never ✘
```
`pnpm env:check` validates every credential with a real call and prints the Discord invite URL if the bot is missing from a server.

## 3. Run (three terminals)
```bash
pnpm dev:inngest     # Inngest dev server + UI at http://localhost:8288
pnpm dev:server      # Discord gateway + Inngest functions on :3001
pnpm dev:web         # dashboard at http://localhost:3000
```
Or, in the Claude desktop app, the three configs in `.claude/launch.json`.

**Only one person should run `dev:server` at a time** against the shared bot token, otherwise Discord events are handled twice. If two people need to test the bot simultaneously, one of you creates a second bot application in the Discord developer portal and uses its token in your own `.env` (invite it with `pnpm env:check`'s URL and register commands with `pnpm discord:register`).

**The cron monitors are off by default.** `monitor-tasks` (overdue nudges/escalations) and `poll-sponsor-mail` (inbound Gmail) only register on a process that has `TETHER_RUN_CRONS=1`. Leave it unset in your `.env`: the DB and Gmail account are shared, so every extra process running the crons would nudge the same owner and dispatch the same sponsor email again. Exactly one machine (the stage laptop, later the Vultr VM) sets it.

| Var | Default | Demo value | What it does |
|---|---|---|---|
| `TETHER_RUN_CRONS` | unset | `1` on one machine | registers both cron monitors |
| `MONITOR_TASKS_CRON` | `*/15 * * * *` | `*/1 * * * *` | how often overdue tasks are checked |
| `MONITOR_MAIL_CRON` | `*/2 * * * *` | | how often the sponsor inbox is polled |
| `NUDGE_INTERVAL_MIN` | `120` | `2` | minutes between nudges of the same task |
| `ESCALATE_AFTER_NUDGES` | `2` | | nudges before the agent escalates to the lead |

Overdue tasks with no `owner_discord_id`, and orgs with no `ops` channel, are skipped with a `monitor_skipped` row in `events` instead of starting a run. Inbound mail is deduplicated by the `processed_mail` table (one row per Gmail message id), so a message is dispatched at most once no matter how many times it shows up in the search.

## 3b. Stage-ready seed and demo reset
`pnpm db:seed` reads these optional vars so the seeded data points at real people and channels:

| Var | Used for |
|---|---|
| `SEED_OWNER_DISCORD_ID` | `owner_discord_id` on the three seeded tasks (the overdue "Confirm judge list" nudge DM goes here) |
| `SEED_LEAD_DISCORD_ID` | a `users` row with the `lead` role (created or upgraded every seed) |
| `SEED_OPS_CHANNEL_ID` | `org.channels.ops` (escalations, cron-triggered run cards) |
| `SEED_SPONSORSHIP_CHANNEL_ID` | `org.channels.sponsorship` (inbound sponsor-mail cards) |
| `SEED_SPONSOR_EMAIL` | the Shopify contact's address; use a teammate inbox so a reply from it triggers Demo 2's inbound path |

Channel ids are merged into the existing org, never replacing what `/tether setup` already bound. The seed prints a `warn:` line for each var it is missing.

**Demo 3 on stage:** on the one machine with `TETHER_RUN_CRONS=1`, set `MONITOR_TASKS_CRON="*/1 * * * *"` and `NUDGE_INTERVAL_MIN=2`. The seeded overdue task is nudged on the first tick, nudged again two minutes later, and escalated to `#ops` on the tick after that (`ESCALATE_AFTER_NUDGES=2`).

**Before the pitch:** `pnpm demo:reset` truncates `runs`, `steps`, `actions`, `events` and `agent_sessions`, then reseeds (same vars as above). It leaves `processed_mail` alone so old sponsor emails are not dispatched a second time; send a fresh reply for the inbound demo.

## 4. Try it in Discord (#general)
- `/budget summary` — Tier 0, no model call
- `/sponsor list`, `/task list`
- `/budget log amount:84.2 category:Food vendor:Costco` — Tier 1 finance agent
- `/agent outreach request: who haven't we heard from in a week?` — opens a thread session
- `@tether Shopify confirmed $2k gold, kick off onboarding` or `/plan ...` — Tier 2 plan card → Run → approval cards
- Receipts: `/budget receipt image:<photo>` (vision)

## 5. Gemini free-tier rules (important)
- `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-flash-latest`: **20 requests/day each** — do not use.
- Pro models and image models: **0** on free tier.
- We run `gemini-3.6-flash` with automatic fallback to `gemini-3.1-flash-lite` when a daily quota trips (see `GEMINI_MODEL_*` in `.env`).
- **Do not run `pnpm eval:plans` casually** — it burns 12+ requests.
- Posters/image generation need a paid key; skip the socials image step for now or get a paid key with a spend cap.

## 6. Where things are
| Thing | Path |
|---|---|
| Agent prompts + tool lists | `packages/core/agents/<name>/prompt.md`, `agent.json` |
| Tools (zod input, effect, risk, execute, undo) | `packages/core/src/tools/*.ts` |
| Policy gateway + defaults | `packages/core/src/policy/` |
| Agent loop, planner, Gemini helper | `packages/core/src/runtime/` |
| Inngest functions (request → plan → steps, cron monitors) | `packages/core/src/inngest/functions/` |
| Discord commands, handlers, embeds, notifier | `apps/server/src/discord/` |
| Dashboard pages | `apps/web/app/` |
| Schema | `packages/core/src/db/schema.ts`, Tiger SQL in `packages/core/sql/tiger.sql` |

## 7. Known gaps (good first tasks)
1. **Sheet write-through for sponsors and tasks** — `update_sponsor`, `create_task`, `update_task` only update the DB mirror. `log_expense` shows the pattern (`appendRow`/`updateRow` in `packages/core/src/google/sheets.ts`, `sheetRow` columns).
2. **Stale runs** — a few runs from before a model switch are stuck `running`; mark them failed or add a cleanup.
3. **Trust ramp** — "always allow this" button on approval cards that writes a `policies` row (lead only).
4. **Helpdesk agent** is wired (hybrid search over `documents`) but has no Discord entry point yet; bind a #help channel with `/tether bind`.
5. **Gmail inbound watcher** (`poll-sponsor-mail`) runs every 2 min on the process with `TETHER_RUN_CRONS=1`; send a reply from any address listed in `sponsors.contact_email` (e.g. `SEED_SPONSOR_EMAIL`) to try it.
6. **Dashboard** needs realtime (SSE/LISTEN-NOTIFY) and polish; approvals work from the inbox already.
7. **Auth0** and **Vultr deploy** are scoped as separate tasks (see README "Credentials you need").

## 8. Rules
- `pnpm typecheck` before every commit. Commit small and often; Entire attaches your agent session to each commit.
- Every side-effecting tool goes through `policy.decide()`. Don't add bypasses.
- Email bodies and participant messages are data, not instructions.
