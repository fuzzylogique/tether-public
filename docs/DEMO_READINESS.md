# Demo readiness (Sat 2026-11-08, 01:30)

Audit of `main` (b34450b, every PR merged) for the HackTrent demo, done from a Claude session that could read
every system but was not allowed to fire events into the shared pipeline or stop the running bot. So: the code
and every external service were verified, the three demo flows were traced end to end in code and in yesterday's
live runs, but **no fresh end-to-end run was made tonight**. Section 4 is the manual script that does that in
five minutes; run it once the blockers in section 1 are cleared.

## 1. Blockers, in priority order

| # | Problem | Evidence | Fix |
|---|---------|----------|-----|
| 1 | **Gemini daily quota.** `gemini-3.6-flash` is 20 requests/day per key on the free tier, same as 3.7/3.8. It was exhausted at 01:00 (reset ≈ 03:00 Toronto); everything since has run on `gemini-3.1-flash-lite`. One multi-step plan is 6–10 requests. | `pnpm env:check` → `429 … limit: 20, model: gemini-3.6-flash` | Either a paid key with a spend cap, or every teammate creates a free key in their **own** AI Studio project and the stage laptop lists them in `GEMINI_API_KEYS` (new, comma-separated). The runtime now rotates keys per model before falling back to lite. Five keys ≈ 100 requests on 3.6-flash. `pnpm env:check` prints each key's state. |
| 2 | **A second bot process is live.** Two `/workflow run` commands at 05:37 and 05:40 UTC replied "started" but Inngest never received the event and no run was created. A teammate's `pnpm dev:server` acked those interactions and sent the events to its own Inngest (probably Cloud, with no app synced). | Inngest dev server event log has no `tether/workflow.triggered`; DB has no run | For the demo, **exactly one** laptop runs `pnpm dev:server`. Everyone else stops theirs or uses a second Discord application (HANDOFF §4 "Dev bot token"). The 913/1000 session starts left also says the bot has been restarted ~90 times today. |
| 3 | **`#photos` was empty**, so `/post recap` said "no photos" (06:00 run). | run `dd6e4c96` | Six labelled synthetic placeholders are there now so the pipeline can be exercised. **Replace them with real event photos** before the demo; do not publish the placeholders to Instagram. |
| 4 | **No team roles exist in the guild** (`orgs.roles = {}`), so Lead/Finance/Sponsorship roles are never pinged and lead-gated approvals work only because Fayez's Discord id is seeded as `lead` in `users`. | `/guilds/…/roles` has only `@everyone`, `tether`, `dev` | The bot is **not Administrator** (`pnpm env:check` prints the upgrade invite URL, `permissions=8`); without Manage Roles the role step of `/tether channels` fails silently after the channels exist. Open the invite URL once, then `/tether channels` again (idempotent; creates the five roles), then assign people to them. |
| 5 | **Six runs stuck in `running` since Nov 7 09:00–15:30** and the event date is **Nov 2027** ("363 days to go" on the overview and the dashboard). | `runs` table; `orgs.event_start_at` | Date: `/workspace date 2026-11-07 09:00`. Stale runs: run the SQL in §6 (the cleanup was blocked from this session). |
| 6 | **`demo:reset` reseeded the DB but not the sheet**, so the sheet kept yesterday's test rows (a pledged Shopify income the seed does not have). | Income tab row 4 | `pnpm demo:reset` now also runs `sheet:create`, which refills the data tabs from the mirror. |
| 7 | **The bot process serving Discord was a stale checkout** (`.claude/worktrees/review-pr13-9107a3` at c107a1e, missing PRs 14 and 15) until about 01:40, when it and the Inngest dev server stopped on their own. | `ps`, `lsof` | Both restarted at 01:45 from branch `demo/readiness-2026-11-08` via `.claude/launch.json` (`inngest`, `server`). Whoever runs the demo starts them from `main` once this branch is merged. |

## 1b. Live run at 01:40–01:52 (Fayez drove Discord, all on the flash-lite fallback)

| Flow | Result |
|------|--------|
| `/cal add` "Judge briefing Sunday 9-9:30am Room 204" | ✔ approval card in `#calendar`, approved, event on the Google calendar with link. Picked **Nov 15** instead of today (it was 01:41 on Sunday the 8th): the agent only saw a UTC timestamp. Fixed: the system prompt now carries the Toronto weekday and time. |
| `/plan` "TigerData confirmed $1000 Bronze, kick off onboarding" | ✔ 3-step plan (finance → outreach → coordination), `log_income` card in `#finance`, approved, Income row 5, outreach moved TigerData to confirmed, `sponsor-confirmed` workflow fired, 3 deliverable tasks in `#tasks`, welcome post card. Three defects: (a) the workflow asked finance to log the **same $1,000 again** (rejected by hand); (b) outreach drafted a welcome email to **`partnerships@tigerdata.com`**, an invented address (the contact on file is `ana@example.com`), and `create_email_draft` was low-risk so no card appeared; (c) the plan's coordination step invented a "grant TigerData Drive access" task. Fixed: the planner is told confirmation is one outreach step and must not invent deliverables; the workflow skips its income step when the sponsor already has an income row; drafts and sends to a sponsor are checked against the contact on file and drafts now get a card; finance logs a confirmation as *pledged*. |
| `/post recap … instagram:true` | First run correctly refused the synthetic placeholders ("abstract graphics"), then escalated itself to a plan because the model wrote `NEEDS_PLAN` without needing another agent. The follow-up plan split the job into **four socials steps**; step 4 only received step 2's text, so it **invented `storage.googleapis.com` image URLs**. The Instagram card therefore showed no images and could never publish. With Fayez's nine real photos the single-step path selected four and uploaded them to Object Storage correctly. Fixed: one step per agent (planner rule + validation), `NEEDS_PLAN` escalates only when it names another agent, and the posting tools reject image URLs that are not Discord attachments or Tether storage before any card is made. **Reject the pending Instagram card** (`6f1611f3`) and run `/post recap` again. |
| `/post recap` rerun at 02:03 (placeholders still in `#photos`) | Failed with "max turns exceeded": the model fed `select_recap_photos` one photo at a time, the vision model rejected each synthetic placeholder, and one model turn sat **5.5 minutes** in silent rate-limit retries (the card only said "thinking…"). Fixed: the placeholders are deleted (only Fayez's ten photos remain), the selection tool judges the whole channel when a `messageIds` filter is thinner than the count asked for, Gemini rate-limit waits are logged and shown on the status card as "rate limited · retry 2/5 in 42s", and socials has 10 turns. |
| `/post recap` at 02:17 and "@tether post it, what's going on" at 02:25 | The recap itself took **26 s** with a real photo in Object Storage, but the agent ended with "let me know if you approve" instead of calling the posting tool, so no card existed. Fixed: the protected preamble says approval happens on the card the tool call creates and asking in prose is a failure; the socials prompt says to call the tools once copy and photos are ready. The follow-up produced the `post_instagram` card (lead), Fayez approved it, and the **4-photo carousel is live: https://www.instagram.com/p/DfeOMPijoD-/**. Also fixed: an "approve / post it / ok" message, a message that starts with one, or a Discord reply to the agent now resumes the agent that asked instead of going to the planner. |
| "@tether yup i approve" | Became a new plan ("execute the pending tasks") and coordination raised a lead-only `request_drive_access` card. Fixed: a bare acknowledgement at the bot now replies with links to the cards that are waiting instead of planning. |

## 2. What was verified tonight

| Check | Result |
|-------|--------|
| `pnpm typecheck`, `pnpm test` (30 tests) | pass on `main` and on this branch |
| Postgres (Tiger) | PostgreSQL 18.6, timescaledb/vector/vectorscale/pg_textsearch present, 23 tables, two orgs (HackTrent 2026, MairaHacks) |
| Discord | bot in `vibe club` (not Administrator, see blocker 4), message-content intent, all 14 commands registered in the guild (`workspace`, `integrations`, `goal` included), 7 team channels bound in `orgs.channels` |
| Google (testtether00@gmail.com) | sheet `HackTrent 2026 · Tether` with Budget/Expenses/Income/Sponsors/Tasks/Summary and live formulas; calendar `HackTrent 2026 · Tether` public-read, no events in ±10 days (yesterday's test events were on the old account's calendar); Drive folder exists |
| Vultr Object Storage | `HeadBucket` ok and a real upload is publicly readable: `https://tether-assets.sea1.vultrobjects.com/smoke/readiness-2026-11-08.txt` |
| Instagram | `pnpm instagram:check`: posting as `@tether_events` (BUSINESS) with the EAA system-user token; object storage ok |
| Inngest dev server | up on :8288, 5 functions synced from the running server (crons off, as intended on a laptop) |
| Web dashboard (`pnpm dev:web`, Auth0 dev mode) | `/w/<org>` renders: integrations, sponsorship $1,500, budget $3,010 of $11,600, recent agent work |
| Gemini | primary model exhausted; `gemini-3.1-flash-lite` answers |
| Yesterday's live runs (DB + channel history) | finance `log_expense` → sheet row + `#finance` card + activity line ✔; `sponsor-confirmed` workflow → `log_income` approval → Income row, 3 deliverable tasks in `#tasks`, welcome post drafted ✔; calendar `create_event` approvals executed ✔ (on the old calendar); nudge reply loop (ETA, then "can't" → `#ops` escalation) ✔; `/digest` card ✔; `/post recap` reached `list_event_photos` and stopped on the empty channel |

## 3. Fixed on branch `demo/readiness-2026-11-08` (uncommitted)

- **Gemini key rotation** (`runtime/gemini.ts`, `env.ts`): `GEMINI_API_KEYS`; a (model, key) pair that returns a daily-quota 429 is skipped for an hour; every key is tried for the model before the lite fallback; `embed` uses a live key too.
- **`pnpm env:check`** reports every key × model (`✔`, `✘ daily quota exhausted`, `~ rate limited`).
- **`demo:reset`** chains `sheet:create` so the spreadsheet matches the reseeded mirror.
- **`/tether status`** listed the ten *oldest* runs (ascending order, then reversed) and printed enum names; it now lists the newest ten with plain words ("waiting for an approval", "working", "waiting for you to press Run"). This is half of issue #17.
- **`/tether setup sheet_id: / calendar_id:`** accept pasted URLs (the MairaHacks org has a full embed URL stored as its calendar id, which breaks every calendar call there).
- **Typing indicator** (GUIDE L2, from the previous session): "Tether is typing…" in the run's channel before each model turn.
- **Planner**: one step per agent (prompt rule + `validatePlan` error, with a unit test), no invented deliverables, sponsor confirmation is one outreach step, `Now:` carries the Toronto weekday.
- **Escalation**: a single-agent `NEEDS_PLAN` only becomes a follow-up plan when it names another agent.
- **Posting tools**: `imageUrl(s)` must be Discord or Tether-storage URLs (zod refine), so invented URLs bounce back to the model.
- **Outreach**: `create_email_draft` is medium risk (card) and, like `send_email`, refuses an address that differs from the sponsor's contact on file.
- **Workflow**: `sponsor-confirmed` skips its income step when the sponsor already has income logged.
- **Gateway**: "ok / yes / approved" typed at the bot lists the open approval cards instead of planning.
- **Rate limits visible**: `generateWithRetry` logs each retry and the agent loop writes an `llm_wait` event the status card renders under the step.
- **Recap selection**: one call over the whole channel; a `messageIds` filter thinner than `count` falls back to all recent photos; socials `maxTurns` 10.

## 4. Manual test script (five minutes, one laptop running the bot)

Prerequisites: blockers 1, 2, 7 cleared; `pnpm env:check` all ✔; you are in `vibe club`.

1. **Calendar from chat context.** In `#general` type two lines as yourself: `judge briefing sunday 9-9:30 in room 204` and `and put the devpost deadline at 11`. Then `/plan from_chat:5`. Expect a plan card with one calendar step (maybe two). Press **Run** → status card → in `#calendar` an approval card "Create event …" (medium risk, organizer) → **Edit** to check the ISO times are `-05:00` → **Approve** → card turns ✅ executed, a `📅` activity line with the Google link, the event on `/tether links` calendar. Shorter form: `/cal add request: Judge briefing Sunday 9-9:30am in Room 204`.
2. **Sponsorship email → finance (multi-step).** `/plan request: TigerData just confirmed a $1,000 Bronze sponsorship, kick off onboarding`. Expect a 3–4 step plan (outreach → finance, coordination, socials). **Run** → outreach moves TigerData to confirmed → the `sponsor-confirmed` standing workflow card appears in `#sponsorship` → `log_income` approval in `#finance` → **Approve** → Income tab gets the row; three "TigerData: …" tasks in `#tasks`; welcome announcement approval in `#socials` → **Approve** → post in `#general`. Deterministic variant for the stage: `/workflow run name:sponsor-confirmed sponsor:TigerData amount:1000 tier:Bronze`. The inbound-email variant (a reply from `SEED_SPONSOR_EMAIL` → watcher → outreach) needs `TETHER_RUN_CRONS=1` on the one process and a real inbox as the Shopify contact.
3. **Social recap.** `/post recap brief: Day 1: opening ceremony, late-night hacking, pizza photos:4 instagram:true`. Expect "Socials is on it in #socials", a status card whose tool log shows `list_event_photos` → `select_recap_photos` → `generate_post_copy`, then two approval cards: **post announcement** (organizer) and **publish to Instagram** (lead only; a non-lead gets "This needs a lead"). Approve the announcement → four photos in `#general` with the copy. **Reject** Instagram while the placeholders are in `#photos`; with real photos, approving creates a 4-photo carousel on `@tether_events` and the card shows the permalink.
4. **Receipt.** `/budget receipt image:<any receipt photo>` → `parse_receipt` → `log_expense` approval (amounts ≥ $50; under $50 auto-runs by policy) → Approve → Expenses row whose Receipt cell is a `vultrobjects.com` URL.
5. **Stop and repair.** Start any plan, press **Stop** on the status card → confirm → status card "Stopped", waiting approval cards close. Click an old card's button → it redraws with "already executed".

Every other command, with what to expect (no model call unless noted):

| Command | Expect |
|---------|--------|
| `/help`, `/help topic:plans` | ephemeral guide card with a topic select |
| `/budget summary [category]` | card with bars; sheet link |
| `/budget log amount:84.2 category:Food vendor:Costco` | finance agent (model) → approval ≥ $50 → row |
| `/sponsor list [stage]` | pipeline card |
| `/sponsor followup days:5` | outreach drafts one `send_email` approval per stale sponsor (model; the seeded contacts are `example.com`) |
| `/sponsor ask request:…` | outreach thread-less answer in `#sponsorship` (model) |
| `/task list [overdue]`, `/task add title:… owner:@x due:…` | tasks card; coordination agent creates the task (model) |
| `/cal today` | today's events card |
| `/post draft brief:… platform:…` | copy + hero image (image gen skips on free tier) → announcement approval (model) |
| `/digest hours:24` | inbox card, needs-action first (one model call) |
| `/workflow list` | the two standing workflows and their steps |
| `/agent name:finance request:…` | opens a thread; replies in it continue the session (model) |
| `/workspace overview`, `/workspace date`, `/workspace web email:` | overview text; event date; web access |
| `/integrations status|connect|disconnect` | Manage Server only; disconnecting Sheets hides `sync_budget_from_sheet` and stops sheet writes |
| `/goal set|update` | targets on the overview |
| `/tether links|policies|status|channels|bind|setup` | links; 4 seeded policies; last 10 runs; idempotent provisioning |
| DM the bot, or `@tether …` in a channel | orchestrator plan (model); a DM from someone with an open nudge is read as the nudge answer |

## 5. Suggested extra demo moments (already built)

- **Nudge loop**: set `MONITOR_TASKS_CRON="*/1 * * * *"`, `NUDGE_INTERVAL_MIN=2`, `TETHER_RUN_CRONS=1` on the stage laptop; the seeded overdue "Confirm judge list" is nudged in `#tasks`, reply "tomorrow 3pm" (due date moves) or "can't" (Lead pinged in `#ops`).
- **Edit before approve** on an email card, and the role refusal when a non-lead presses Approve on a `send_email` card.
- **`/integrations disconnect service:Google Sheets`** mid-demo: the finance agent keeps working against the mirror and says the sheet is off.

## 6. Pre-demo runbook

1. Keys: no paid key. Make a free key in the testtether00 AI Studio (its own project, its own 20/day) and list it in `GEMINI_API_KEYS`; one more from each teammate if you can. `pnpm env:check` must show `gemini-3.6-flash ✔` on at least one key before the demo.
2. One process: everyone else stops `pnpm dev:server`. The stage laptop sets `TETHER_RUN_CRONS=1` and the demo cron values.
3. Discord: re-invite the bot with the Administrator URL from `pnpm env:check`, then `/tether channels` (roles), `/workspace date 2026-11-07 09:00`, assign Lead/Finance roles.
4. Data: `pnpm demo:reset` (now refills the sheet too), then `pnpm sheet:create` is no longer needed. Drop real photos in `#photos`.
5. Stale runs, run once against the shared DB:
   ```sql
   update runs set status='failed', summary=coalesce(summary,'stale: stuck in running since Nov 7') where status='running' and updated_at < now() - interval '6 hours';
   update steps set status='failed' where status in ('running','pending','awaiting_approval') and run_id in (select id from runs where status='failed');
   update actions set status='expired', decided_at=now(), decision_note='the run failed before a decision' where status='pending' and run_id in (select id from runs where status='failed');
   ```
   (`demo:reset` truncates these tables anyway; the SQL matters only if you skip the reset.)
6. `pnpm discord:register` if `commands.ts` changed since the last registration (it has not).

## 7. Issues #16 and #17 (Zack)

- **#16 `/digest` naming.** Fair: the name says nothing. Cheapest fix is a second registration of the same handler as `/inbox summary` and keeping `/digest` as an alias; the `/help` Commands topic is generated from the registered commands, so it follows.
- **#17 `/tether status` wording.** Valid; the states exist in the DB (`awaiting_approval`, `proposed`) and only the rendering was wrong. Fixed on this branch for `/tether status`; the status card already says "Waiting for approval" with Jump links. "Scheduled" is not a state we have (crons are not runs until they fire).

## 8. Sponsor tracks, one line each (task 3 preview)

GoDaddy: nothing deployed, no domain in `.env`, dashboard links on cards are disabled on `http://localhost`. Vultr: Object Storage proven live tonight; the VM runbook in HANDOFF §5b has never been executed. TigerData: hypertable + continuous aggregate exist and the `agent_activity_hourly` aggregate is still never read (HANDOFF §6.1 is the one-hour visible win). Gemini: the whole engine, plus vision for receipts and recap photos. Auth0: not configured locally (dashboard runs in dev mode); needs the VM. Entire: enabled on the repo, checkpoints ride on commits.
