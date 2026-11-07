# Tether handoff (2026-11-07, end of day 1)

For whoever picks up iteration tomorrow, starting with the Vultr integration. Written after auditing every branch, worktree and Claude session of the day. Read `docs/ARCHITECTURE.md` for the design and `docs/REVIEW.md` for the pre-demo adversarial review this doc keeps referring to; `docs/ONBOARDING.md` gets you running locally.

## 1. Where the code is

Everything that was built today is on `origin`. No worktree has uncommitted or unpushed work. The only local-only files are two scratch scripts (`packages/core/.fire.mts`, `.local.mts`) a live-test session wrote; they are untracked and should stay that way.

| Branch | PR | State | What it carries |
|---|---|---|---|
| `main` | | 5534a1f | PRs 1 to 4 merged: adversarial review doc, cron gating + `processed_mail` + stage-ready seed, Discord UI design system (Components V2 cards, SVG charts, app emoji), team channels + Gemini quota guards. |
| `feat/recap-photos` | [#8](https://github.com/fuzzylogique/tether/pull/8) → main | open, mergeable | 4 commits: receipts to Object Storage, finance sheet (income, reimbursements, HST, Summary tab), recap posts from `#photos`, nudge replies, approval-card routing by team, `/plan from_chat`, standing workflows, inbox digest. |
| `feat/finance-receipts-and-sheet` | [#5](https://github.com/fuzzylogique/tether/pull/5) → main | open, **superseded** | First 2 commits of #8. Same code. |
| `feat/recap-photos` | [#6](https://github.com/fuzzylogique/tether/pull/6) → #5 | open, **superseded** | Same head commit as #8, stacked base. |
| `claude/clever-kare-486733` | [#7](https://github.com/fuzzylogique/tether/pull/7) → main | open, mergeable | Safe `pnpm db:push` (`src/db/push.ts`, protected Timescale objects, `pnpm db:plan`), 20 FKs and 5 indexes already applied to the shared DB. |
| `docs/handoff-2026-11-07` | this doc | | |

**Merge plan.** Merge #8, then #7, then close #5 and #6 as superseded (GitHub will not auto-close them because #8 is a different PR on the same branch). #7 and #8 conflict only in one paragraph of `docs/ARCHITECTURE.md` (the "Data" section: #7 corrects the hypertable claim and adds the push rules, #8 adds the finance-sheet subsection; keep both, and keep `income` in the mirror-table list). `schema.ts` and `tiger.sql` auto-merge, and the merged tree passes `pnpm typecheck` (checked in a scratch worktree tonight). Whoever merges #7 should also pull before the next `pnpm db:push`: the old script reported success while doing nothing.

**Worktrees to clean up.** `.claude/worktrees/festive-hypatia-dc939c` (PR 2) and `wizardly-maxwell-4ba33f` (PR 3) are merged and stale. `clever-kare-486733` is PR 7; remove it after #7 merges.

**Schema state.** The shared Tiger database already has every column from #8 (applied through the idempotent statements in `sql/tiger.sql`) and every FK and index from #7. Nobody needs to run `db:push` for the current code. After #7 merges, `pnpm db:plan` is the dry run to use before any push.

## 2. What has been built, and why

### Engine (packages/core/src/runtime, inngest/functions)
- **Request → plan → plan card → executor → agent loop → policy gateway → approval card → resume.** The pipeline in ARCHITECTURE.md is verified live end to end (Discord → Inngest → Gmail send). Durable waits (`waitForEvent` with reminder and expiry), memoized agent turns, parallel dependency levels.
- **Policy gateway** (`policy/engine.ts`): every side-effecting tool declares `effect` and `risk`; `decide()` returns run / approve / deny; org `policies` rows loosen defaults (seeded: `log_expense` under $50 auto-runs). This is the architectural idea the pitch rests on.
- **Failure visibility** (PR 4): failed steps mark the run failed, Gemini 429/503 retry with backoff, daily-quota exhaustion falls back to `GEMINI_MODEL_FALLBACK` instead of retrying, and a failed run no longer multiplies model calls.
- **Cron gating** (PR 2): `monitor-tasks`, `poll-sponsor-mail` and `inbox-digest` register only on the one process with `TETHER_RUN_CRONS=1`. Gmail dedup is a `processed_mail` table, not a last-message-id. Ownerless tasks and orgs without `#ops` are skipped with an `events` row.
- **Nudge loop** (PR 8): the monitor claims an overdue task with one conditional UPDATE that owns `nudge_count` and `escalated`; the agent only writes the message. Replies (DM or reply in `#tasks`) become `tether/nudge.replied`, classified by one structured Gemini call into eta / done / cannot / question / other.
- **Standing workflows** (PR 8, `workflows/registry.ts`): prebuilt DAGs fired by events, approved once when the org turns them on, tools still gated by policy. `sponsor-confirmed` is the first one.
- **Plan from chat** (PR 8): `/plan from_chat:N` feeds the last N human messages to the planner as data.
- **Inbox digest** (PR 8): `/digest` and `DIGEST_CRON` summarize the organizer inbox to `#ops`, needs-action first.

### Discord adapter (apps/server/src/discord)
- **Components V2 card system** (PR 3): semantic cards in `core/ui/cards`, pixels at the edge (`ui/render.ts`), SVG charts rasterised with `@resvg/resvg-js` and vendored Inter so output is identical on macOS and the Alpine image. `pnpm discord:preview` posts every card from fixtures; `pnpm test:charts` snapshots the SVGs. Application emoji, bot avatar and banner come from the same pipeline (`pnpm discord:emoji`).
- **Team channels and roles** (PR 4 + PR 8): `/tether channels` creates the Tether category (ops, tasks, calendar, finance, sponsorship, socials, photos), one Discord role per team, optional channel→agent binding. Single-agent runs render in their team channel; approval cards go to the channel of the team that owns the decision; every executed side effect is mirrored as one activity line (`runtime/feed.ts`). `/tether links` prints the shared calendar, sheet and Drive folder.

### Finance (PR 5 / #8)
- Receipt attachments travel from the Discord message through `handle-request` and `run-plan` into the agent step (REVIEW item 3; Demo 1 was dead before this).
- `parse_receipt` uploads a durable copy to **Vultr Object Storage** under `receipts/<org>/<ts>.<ext>` and returns that URL; Discord CDN links expire within hours. Without `S3_*` keys it keeps the Discord URL.
- Income is its own concept (`income` table, `log_income`, Income tab) so "Shopify confirmed $2k" stops becoming an expense. Reimbursements (`paid_by`, `mark_reimbursed`), HST extraction, and a formulas-only Summary tab. `sync_budget_from_sheet` validates every cell and replaces the mirror in one transaction.

### Socials (PR 6 / #8)
- `/post recap`: `list_event_photos` reads `#photos`, `select_recap_photos` asks Gemini vision to pick the best N with captions and stores full-size copies in Object Storage, `post_announcement` accepts up to four images and the approval card shows them as a gallery.
- `media.ts`: one trusted-host check (Discord CDN + our bucket) and a size-capped fetch, shared by receipts and photos (REVIEW SSRF finding).

### Data and tooling
- Safe `pnpm db:push` (PR 7): plans through drizzle-kit's API, refuses to touch the continuous aggregate, hypertable index and BM25 index, holds back destructive statements unless `--allow-destructive`, exits 1 on failure.
- `pnpm env:check` (`scripts/doctor.ts`) validates every credential with a real call, including a `HeadBucket` against the S3 bucket.
- `pnpm sheet:create`, `pnpm google:share`, `pnpm demo:reset`, stage-ready seed vars (`SEED_*`).

### Infra (never deployed yet)
- `infra/docker-compose.yml` (server, web, caddy), `Dockerfile.server`, `Dockerfile.web` (Next standalone), `Caddyfile` routing `/api/inngest` and `/health` to the server and everything else to the web app, TLS from Caddy on `$DOMAIN`.

## 3. What was deprecated or replaced, and why

| Replaced | By | Why |
|---|---|---|
| Hero image generation as the default socials moment | Real photos from `#photos` ranked by Gemini vision; image gen is a graceful `{ skipped, reason }` fallback | Free-tier Gemini keys have zero image quota, so every socials run threw (REVIEW item 10). |
| Google Photos as the photo source | Discord `#photos` channel | Since 2025 the Photos Library API only returns media the app itself uploaded; the Picker API needs a human in Google's UI. |
| Plain `EmbedBuilder` embeds | Components V2 cards + rasterised SVG charts | Embeds could not show progress, galleries or charts; see `docs/DISCORD_UI.md`. |
| `drizzle-kit push` straight from the pnpm script | `src/db/push.ts` | drizzle-kit tried to `DROP` the continuous aggregate, failed, exited 0, and never ran the `ALTER TABLE`s; the shared DB had no foreign keys. |
| `lastMessageId` Gmail dedup | `processed_mail` table | Flip-flopped on threads with two inbound messages and re-dispatched every 2 minutes. |
| Crons on every dev server | `TETHER_RUN_CRONS=1` on exactly one process | Shared DB and Gmail account; every laptop nudged the same owner and re-sent the same mail. |
| Escalation decided by the model echoing the task title | Monitor owns `nudge_count` and `escalated` in the claim UPDATE | Escalation was unreliable and un-demoable. |
| Nudges by DM only | `#tasks` with an @mention, DM fallback; replies handled either way | DMs failed silently when the owner had DMs closed, and replies were ignored. |
| Sponsor money logged as an expense | `income` table + `log_income` | Finance had no concept of income (REVIEW item 8). |
| Claim that `runs/steps/actions/events` are hypertables | Only `events` is, with `agent_activity_hourly` on top (PR 7 fixes the doc) | The others never were; the doc overclaimed. |
| Branch `docs/adversarial-review` | deleted after PR 1 merged | housekeeping |

## 4. Proposed but not built

Ordered by what matters for the demo on Nov 8. The REVIEW.md "ten things" are tracked first because judges will probe them.

| # | Item | Status tonight | Where to start |
|---|---|---|---|
| R1 | Role-gated approvals. `decide()` returns `approverRole: "lead"` but nothing stores it on `actions` or checks it in the Discord button handler or the web server action; unknown Discord users default to `organizer` (`runtime/context.ts:12-15`). | **open** | Store `approverRole` on the action row; check it in `handlers.ts` button path and `apps/web/app/actions.ts`; map Discord team roles (now created by `/tether channels`) to `users.roles`; default unknown users to `participant`. |
| R2 | Failures visible in Discord | **done** (PR 4) | |
| R3 | Attachments reach the finance agent | **done** (#8) | |
| R4 | Crons tamed | **done** (PR 2) | |
| R5 | Inbound email as data | **partial**: the body is framed as untrusted in `monitors.ts:134`, but `cc` is still a free string (`outreach.ts:78`) and `gmail.ts` does not strip CR/LF, so header injection is still possible; the approval card should render `cc`. | Validate `cc` as `z.string().email()` array, strip `\r\n` in `encodeMessage`, render every arg on the card. |
| R6 | `INNGEST_DEV=1` in prod disables signature checks | **open**: `.env.example` still ships it; nothing refuses to boot in production without a signing key. | In `apps/server/src/index.ts`, throw if `NODE_ENV=production` and (`INNGEST_DEV` set or `INNGEST_SIGNING_KEY` empty). Remove the line from `.env.example` or comment it. |
| R7 | `tether/plan.approved` live trigger bypasses `plan/decided` | **partial**: `requiresPlanCard` now derives from the plan, but `plans.ts:18` still lists the trigger. | Assert `status === "approved"` atomically in `run-plan` or drop the trigger. |
| R8 | Org brief into planner and agents | **partial**: planner takes `context` (used by `from_chat`), but no standing org brief (event, dates, tiers, sponsor and budget snapshot). | Build `orgBrief(org)` in `runtime/context.ts`, inject into `draftPlan` context and the agent preamble. |
| R9 | Per-tool approval cards, outcome shown, Undo | **partial**: cards per tool and decision re-render exist (PR 3); **Undo is written on three tools but no button calls it**. | Add an Undo button to the executed card, handler calls `tool.undo(args, result)` through policy. |
| R10 | Sponsor-track depth | **partial**: receipts to Object Storage done, image gen fixed, dashboard links via `WEB_PUBLIC_URL` in `runtime/cards.ts`. Still `ILIKE` keyword leg in `helpdesk.ts:23` (BM25 index unused), `agent_activity_hourly` never queried, **nothing deployed to Vultr**. | §5 below for Vultr. BM25: swap the ILIKE CTE for `content <@> to_bm25query(...)` per the comment at `helpdesk.ts:16`. Activity chart: a sparkline card from `agent_activity_hourly` on `/tether status` (DISCORD_UI stretch row). |

Beyond the review list:

- **Instagram publishing** (session "Instagram posting feature setup", nothing written). Plan: `instagram_post` tool in `tools/socials.ts`, `effect: "external"`, `risk: "high"` so it always gets an approval card; publishes the recap photos already in Object Storage (Instagram needs public JPEG URLs, carousel up to 10). Needs a professional Instagram account, a Meta app with "Instagram API with Instagram Login", scopes `instagram_business_basic` + `instagram_business_content_publish`, testing mode is enough. Blocked on account creation, which Fayez is doing next.
- **New Google account for the bot.** There is no shared drive: `google-share.ts` creates a normal folder with the `drive.file` scope, so the app only sees files it created. Migration is: new account as test user on the OAuth client → `pnpm google:auth` as that account → new `GOOGLE_REFRESH_TOKEN` → `pnpm google:share` and `pnpm sheet:create` create a fresh folder, calendar and sheet and bind them to the org. The old sheet's rows do not carry over automatically; `sync_budget_from_sheet` can re-import Budget/Expenses if someone pastes the tabs. Fayez is doing this.
- **Dev bot token for teammates.** Once the real bot runs on the VM, any `pnpm dev:server` with the same `DISCORD_TOKEN` is a second copy of the bot and double-replies. Create a second Discord application, invite it to the dev guild, give teammates that token, `pnpm discord:register` against it.
- **Sheet write-through for sponsors and tasks** (ONBOARDING §7.1): `update_sponsor`, `create_task`, `update_task` only touch the mirror. `log_expense` shows the `appendRow`/`updateRow` pattern.
- **Trust ramp**: "Always allow this" on approval cards writing a `policies` row, lead only.
- **Helpdesk agent** has hybrid search but no Discord entry point; bind a `#help` channel.
- **Dashboard**: no realtime (uses `revalidatePath`), approvals not role-checked, not org-scoped.
- **DISCORD_UI Phase 4**: webhook personas per team channel (avatars would live in Object Storage), `task:done` and "Answer in thread" buttons.
- **Tests and CI**: only `charts.test.ts` exists. `decide()`, `validatePlan`/`levels`, and the loop's gating are the ones worth writing first; a GitHub Action running `pnpm typecheck` + `test:charts` would have caught nothing today but will tomorrow.
- **Entire Brain/Graph** (session "Agent updates for event planning"): proposed as the honest Entire-track story (team memory across parallel Claude sessions, `entire tokens profile` for a real number). Deferred; about 30 minutes of setup, writes managed blocks into `CLAUDE.md`, every teammate runs it locally. Agent customization as a product feature was judged half a day and deferred behind the review fixes.
- **Small bug**: `pnpm discord:channels` does not load `.env` (works with `node --env-file=.env`); the `/tether channels` slash command is fine.
- **ARCHITECTURE stretch list**, still untouched: Token Vault (per-organizer Google), CIBA, builder agent + Entire external agent, Tiger forks for dry-run plans.

## 5. Vultr: what exists, what was never verified, how to finish it

Nothing Vultr-side has been exercised with real credentials. No `S3_ACCESS_KEY` has ever been set on a dev machine, no VM has been provisioned, and `DOMAIN` is not even in `.env.example`. The code paths are written and typecheck; they have only ever run through their "unconfigured" fallbacks.

### 5a. Object Storage (do this first, it unblocks the receipt and recap demos)

What the code does (`packages/core/src/storage.ts`, `media.ts`, `scripts/doctor.ts`):
- Client is `@aws-sdk/client-s3` with `endpoint: S3_ENDPOINT`, `region: "us-east-1"`, `forcePathStyle: false`. Public URL is `https://<S3_BUCKET>.<endpoint host>/<key>`, so with `S3_ENDPOINT=https://ewr1.vultrobjects.com` and bucket `tether-assets` objects must resolve at `https://tether-assets.ewr1.vultrobjects.com/...`.
- Uploads use `ACL: "public-read"`. Keys: `receipts/<org>/<ts>.<ext>`, recap photos and hero images under their own prefixes (see `tools/socials.ts`).
- `trustedMediaUrl` only allows the Discord CDN and exactly that bucket host, so a wrong `S3_ENDPOINT` makes the bot refuse to read back its own uploads.
- `pnpm env:check` runs `HeadBucket`.

Steps:
1. In the Vultr console create an Object Storage subscription in **New Jersey (ewr1)** (or change `S3_ENDPOINT` to match the region you pick), create bucket `tether-assets`, and copy the access key and secret.
2. Fill `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` in `.env`. Run `pnpm env:check`; the Vultr line must read `bucket tether-assets reachable`.
3. Verify a real upload and public read with a one-off script, before touching Discord:
   ```bash
   node --env-file=.env --import tsx -e 'import("./packages/core/src/storage.js").then(async s=>{const u=await s.uploadObject("smoke/hello.txt",Buffer.from("hi"),"text/plain");console.log(u);console.log((await fetch(u)).status)})'
   ```
   Expect the URL and `200`. If you get `403`, the bucket is rejecting `public-read` ACLs (Vultr honours them, but check the bucket's permissions tab). If the hostname does not resolve, the region in `S3_ENDPOINT` is wrong.
4. In Discord, `/budget receipt image:<photo>`: the Receipt column of the Expenses tab should now hold a `vultrobjects.com` URL instead of a `cdn.discordapp.com` one. Then drop three photos in `#photos` and `/post recap`; the approval card's gallery URLs should also be on the bucket.
5. Decide on lifecycle. Receipts should be kept; `smoke/` and hero-image test objects can go. There is no delete path in the code, which is fine for a hackathon.

### 5b. The VM

What exists: `infra/docker-compose.yml` builds `server` (Hono + Discord gateway + Inngest endpoint on 3001, run with `tsx` in production, which is fine for now) and `web` (Next standalone on 3000), and runs Caddy on 80/443 with TLS for `$DOMAIN`. `env_file: ../.env` is relative to the compose file, so the VM needs the repo checked out with `.env` at its root.

Steps:
1. Provision a Vultr Cloud Compute instance (Ubuntu 24.04, 2 vCPU / 4 GB is enough; the `web` image build is the heavy part), add your SSH key, open 80 and 443 in the Vultr firewall.
2. `apt install docker.io docker-compose-v2 git`, clone the repo, `scp` the `.env`.
3. Edit the VM's `.env`:
   - **Remove `INNGEST_DEV=1`.** With it set, events go to a local dev server that does not exist, and the SDK skips signature validation on a public endpoint.
   - Keep `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`; in the Inngest dashboard confirm they belong to the Production environment.
   - Add `DOMAIN=<your GoDaddy domain>` (also add it to `.env.example`). Set `APP_BASE_URL=https://<domain>`, `WEB_PUBLIC_URL=https://<domain>`, `SERVER_PUBLIC_URL=https://<domain>`.
   - Set `TETHER_RUN_CRONS=1` here and **unset it on every laptop**. The VM is now the one process that nudges, polls Gmail and posts the digest.
   - `NODE_ENV=production`.
   - Auth0: add `https://<domain>/auth/callback` to Allowed Callback URLs and `https://<domain>` to Allowed Logout URLs on the Auth0 application.
4. GoDaddy DNS: an `A` record for the domain (and `www` if you want it) pointing at the VM's IP. Caddy will not get a certificate until DNS resolves, so do this before `compose up`.
5. `docker compose -f infra/docker-compose.yml --env-file .env up -d --build`. Check `curl https://<domain>/health` returns `{"ok":true,"discord":true,"functions":N}`.
6. **Sync Inngest Cloud** so it learns the functions: in the dashboard "Sync new app" with `https://<domain>/api/inngest`, or `curl -X PUT https://<domain>/api/inngest`. Repeat after any deploy that adds or changes functions.
7. Smoke test: `/budget summary` (Tier 0, no model), then `/plan ...`, and confirm the run appears in the Inngest Cloud dashboard and the status card updates. `https://<domain>/runs` should show it (dashboard links on cards now point at the real domain, which is the GoDaddy track's visible moment).
8. Stop running `pnpm dev:server` on laptops with the production token (see "Dev bot token" in §4), or the bot double-replies during the demo.

Things that may bite:
- `Dockerfile.server` runs `pnpm install --frozen-lockfile=false --filter @tether/server...` and the project has `onlyBuiltDependencies` for `sharp`; `@resvg/resvg-js` ships `linux-musl` binaries so Alpine is fine, and the Inter fonts are vendored under `apps/server/assets/fonts`.
- `Dockerfile.web` copies `packages/core/agents/**` into the standalone output via `outputFileTracingIncludes`; if the Agents page is empty, that trace is what to check.
- Caddy stores certificates in `infra/caddy_data` (gitignored). Keep that volume across redeploys or you will hit Let's Encrypt rate limits.
- The server container needs outbound access to Discord's gateway, Google APIs, Gemini and the bucket; the Vultr default firewall allows outbound.
- `demo:reset` and `db:seed` should be run from a laptop against the shared DB, not from inside the container.

### 5c. What to say in the pitch about Vultr
Receipts and recap photos are durable in Object Storage (Discord CDN links expire in hours; the sheet's Receipt column proves it), the bot and dashboard run on a Vultr VM behind Caddy on the GoDaddy domain, and the one process with `TETHER_RUN_CRONS=1` is that VM. Optional polish: agent avatars for webhook personas also live in the bucket (DISCORD_UI Phase 4).

## 6. Ideas worth adding, and how

1. **Agent activity chart from the continuous aggregate** (TigerData story, ~1 h). `agent_activity_hourly` is refreshed and never read. Add a `sparkline` card (chart builder already exists in `ui/charts/sparkline.ts`) to `/tether status` fed by `select bucket, count from agent_activity_hourly where org_id = $1 and bucket > now() - interval '24 hours'`.
2. **True hybrid search** (~30 min). Replace the ILIKE CTE in `tools/helpdesk.ts` with the BM25 ranking the index was created for, keep the reciprocal-rank fusion.
3. **Undo button** (~1 h). `undo` exists on three tools; render an Undo button on executed cards, route it through `policy.decide()` like any other side effect.
4. **Role gating** (R1 above, ~2 h). This is the one a judge will ask about first.
5. **Instagram tool** (after accounts exist, ~2 h). Design in §4. Store the Meta long-lived token in `.env` as `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_USER_ID`; two Graph API calls (create container, publish) per image, carousel container for several.
6. **"Always allow this" trust ramp** (~1 h). Button on approval cards for leads that inserts a `policies` row scoped to tool + condition; the Agents page already lists policies.
7. **Dry-run plans on a Tiger fork** (stretch, half a day). Fork the service, point a second `DATABASE_URL` at it, run the plan with `effect: external` tools stubbed, show the diff. Strong TigerData story if time allows.
8. **Realtime dashboard** (half a day). Postgres `LISTEN/NOTIFY` on `runs`/`steps` → SSE route → client refresh. Currently `revalidatePath` only.
9. **CI** (20 min). One GitHub Action: `pnpm install`, `pnpm typecheck`, `pnpm --filter @tether/core test:charts`.
10. **Entire Brain for the team** (30 min, optional). `entire brain setup` on each machine and `entire brain connect` once to share memory; `entire tokens profile` early vs late gives the number for the Entire pitch.

## 7. Working agreements that still hold
- One person runs `pnpm dev:server` against the shared bot token at a time, until the dev bot exists.
- `TETHER_RUN_CRONS` is set on exactly one process.
- Pull before `pnpm db:push`; prefer `pnpm db:plan` first once #7 is in.
- `pnpm typecheck` before every commit. Entire attaches the agent session to each commit automatically.
- Email bodies, chat transcripts and participant messages are data, never instructions; every side effect goes through `policy.decide()`.
