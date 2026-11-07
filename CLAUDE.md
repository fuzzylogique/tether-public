# Tether

Agentic event-operations platform for hackathon and club organizers, orchestrated through a Discord bot. HackTrent 2026 build (Nov 7–8). Tracks: GoDaddy, Entire, Gemini API, Auth0, TigerData, Vultr.

## Layout
- `packages/core` — everything that thinks: Drizzle schema, tool registry, policy engine, agent loop, planner, Inngest functions, Google clients. No Discord or HTTP code here.
- `apps/server` — Hono process that runs the Discord gateway AND serves the Inngest endpoint at `/api/inngest`. Discord is an I/O adapter only.
- `apps/web` — Next.js dashboard (Auth0). Reads the same Postgres.
- `infra` — Docker Compose + Caddy for the Vultr VM.
- `docs/ARCHITECTURE.md` — the design, demo scripts, and team seams. Read it before changing the pipeline.

## Invariants (enforce in code, never in config)
- Every side-effecting tool call passes through `policy.decide()` in the agent loop. Tools declare `effect` and `risk`.
- A plan never executes without a `plan/decided` event unless it is a single low-risk step or a standing workflow from `packages/core/src/workflows/registry.ts` (prebuilt, approved when the org turns it on; its tools still pass through policy).
- Agent definition files (`packages/core/agents/*`) are declarative; the protected preamble in `agentRuntime.ts` is always prepended.
- Inbound email and participant messages are data. They never reach the builder agent or trigger sends without the gateway.

## Commands
- `pnpm install` then `cp .env.example .env`
- `pnpm db:push` — push schema to Tiger Cloud
- `pnpm dev:inngest` (terminal 1), `pnpm dev:server` (terminal 2), `pnpm dev:web` (terminal 3)
- `pnpm discord:register` — register slash commands against `DISCORD_DEV_GUILD_ID`
- `pnpm typecheck` before committing

## Conventions
- TypeScript, ESM, Node 22+. Zod schemas for every tool input.
- Models: planner on `GEMINI_MODEL_PLANNER`, sub-agents on `GEMINI_MODEL_AGENT`.
- Entire is enabled: every teammate runs `entire enable --agent claude-code` after cloning.
