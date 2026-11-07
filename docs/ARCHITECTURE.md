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
Tiger Cloud Postgres. `runs/steps/actions/events` are hypertables. `documents` uses pgvector + pg_textsearch hybrid search. Mirror tables: `budget_lines`, `expenses`, `income`, `sponsors`, `sponsor_threads`, `tasks`, `calendar_events`.

### Finance sheet
`pnpm sheet:create` builds (or upgrades) the org Google Sheet from the mirror; re-running it adds missing tabs and rewrites headers and formulas.
- `Budget`: Category, Allocated.
- `Expenses`: Date, Category, Amount (total incl. tax), Vendor, Description, Receipt (Vultr Object Storage URL), Logged by, Tax, Paid by, Reimbursement (`pending`/`paid`). Columns are only ever appended so older sheets keep syncing.
- `Income`: Date, Source, Amount, Status (`pledged`/`invoiced`/`received`), Notes. Sponsor money goes here via `log_income`, never into Expenses.
- `Summary`: formulas only (per-category spend, totals, HST paid, income, net position, reimbursements owed per person). Organizers can edit the data tabs by hand and `sync_budget_from_sheet` validates every cell before replacing the mirror in one transaction.

## Infra
Vultr VM → Docker Compose (server, web, caddy). Inngest Cloud. Auth0 for dashboard + roles. Single organizer Google account (refresh token). GoDaddy domain → Caddy.

## Demo scripts
1. Receipt photo → finance logs expense, budget status.
2. "Shopify confirmed $2k, kick off onboarding" → plan card → untick one step → run → emails await approval → calendar + sheet + post update.
3. Overdue task → nudge DM → no response → escalate to lead.
4. `/post recap` → socials lists the photos the team dropped in `#photos` → Gemini vision picks the best four with captions and stores durable copies in Object Storage → copy written to match → approval card showing all four → announcement. Hero image generation is the fallback when there is nothing to photograph yet, and it skips gracefully on a free-tier key.

## Team seams
A: engine, planner, gateway (core/runtime). B: tools, mirror, watchers (core/tools, core/google). C: web + Auth0. D: Discord adapter, seed data, demo.

## Stretch, in order
calendar + socials polish, receipt vision, Token Vault, CIBA, helpdesk RAG, builder agent + Entire external agent, Tiger forks for dry runs.
