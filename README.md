# Tether

Agentic event operations for hackathons and club events, run from Discord with a web dashboard for oversight.

Organizers talk to Tether in Discord. It proposes a plan, they tick the steps they want, and specialized agents (finance, sponsorship outreach, socials, calendar, coordination, helpdesk) do the work through Google Sheets, Gmail, and Calendar. Anything risky waits for a human. Every run is traceable on the dashboard.

## Stack
Discord (discord.js) · Gemini (`@google/genai`, function calling + structured output + vision + image gen) · Inngest (durable workflows, human-in-the-loop waits, cron) · TigerData Postgres (hypertables, pgvector hybrid search, forks) · Auth0 (dashboard login, roles) · Next.js dashboard · Vultr VM + Object Storage · GoDaddy domain · Entire (agent session checkpoints).

## First run
```bash
git clone <repo> && cd tether
entire enable --agent claude-code     # every teammate, once per clone
pnpm install
cp .env.example .env                  # fill in keys
pnpm db:push                          # schema + Tiger hypertables
pnpm db:seed                          # demo org, budget, sponsors, tasks, FAQ
pnpm discord:register                 # slash commands in your dev guild
```
Then in three terminals: `pnpm dev:inngest`, `pnpm dev:server`, `pnpm dev:web`. Open http://localhost:8288 (Inngest), http://localhost:3000 (dashboard).

In Discord: `/tether setup` with your channels, then try `/budget summary`, `/plan Shopify confirmed $2k gold, kick off onboarding`, or mention the bot.

## How a request flows
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Short version: Discord → Inngest event → orchestrator drafts a plan → plan card (edit/approve) → executor runs agents in dependency levels → each tool call passes the policy gateway → approval cards for anything risky → status embed updates in place → dashboard shows the trace.

Pre-demo adversarial review (two independent reviewers, Nov 7): [docs/REVIEW.md](docs/REVIEW.md). Start with its ranked top-ten list and the invariant scorecard.

## Credentials you need
- **Discord**: bot token + client id, Message Content intent enabled, invited with `applications.commands` and `bot` scopes.
- **Gemini**: API key from AI Studio.
- **Google**: OAuth client (Desktop/Web), consent screen in Testing with organizers as test users, scopes for Sheets, Gmail (send + readonly), Calendar, Drive. Obtain a refresh token once (any OAuth playground works) and put it in `.env`.
- **TigerData**: Tiger Cloud service URL as `DATABASE_URL`.
- **Inngest**: free cloud keys for prod; blank for the local dev server.
- **Auth0**: Regular Web App, callback `${APP_BASE_URL}/auth/callback`, logout `${APP_BASE_URL}`. Add an Action that puts roles on the ID token as `https://tether/roles`.
- **Vultr**: VM (Docker) + Object Storage keys. Deploy with `docker compose -f infra/docker-compose.yml --env-file .env up -d --build` and point the GoDaddy A record at the VM.

## Planner evaluation
`pnpm eval:plans` runs the fixture set and prints validity, agent precision/recall, and dependency correctness. Decision gate is in `docs/ARCHITECTURE.md`.
