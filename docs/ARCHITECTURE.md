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
Tiger Cloud Postgres. `runs/steps/actions/events` are hypertables. `documents` uses pgvector + pg_textsearch hybrid search. Mirror tables: `budget_lines`, `expenses`, `sponsors`, `sponsor_threads`, `tasks`, `calendar_events`.

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
