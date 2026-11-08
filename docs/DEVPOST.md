# Devpost submission draft

**Status (Nov 8, 2026):** the draft exists on Devpost and every text field below is already pasted in.
Edit it at https://devpost.com/submit-to/31951-hacktrent-2026/manage/submissions/1285537-tether/project-overview
(public preview: https://devpost.com/software/tether-yzqh3o). Deadline on the hackathon page: **Nov 8, 2026 @ 11:00am EST**.

**Live deployment (Maira, Nov 7 evening):** https://216-128-176-47.sslip.io on a Vultr VM (2 GB, Docker Compose + Caddy,
Let's Encrypt via sslip.io). The dashboard is up behind her Auth0 tenant; the bot container was down on Nov 8 morning
(`/health` 502). The public `/demo/<org>` view only exists after a redeploy of current `main`; until then that link redirects to the Auth0 login like the root does. Only her SSH key and Vultr account can reach it: to redeploy, she runs
`infra/deploy.sh 216.128.176.47 --bot` (after stopping the laptop bot), or adds another public key to the VM.

Still empty on Devpost, all of them need a person:
- **Video demo link** (required) — teammate is producing the video; paste the YouTube/Vimeo URL under Project details.
- **Public GitHub repository link** (required) — the working repo stays private; publish a separate public repo from this
  branch only, without the `refs/entire/checkpoints/*` refs, and link that.
- **"Try it yourself" section below** — new, not on Devpost yet; paste it in once the public repo URL exists.
- **Teammates** — Manage team, invite by Devpost username or email.
- **Universities** — currently "University of Waterloo" only; add each teammate's school.
- **Gemini Project Number** — AI Studio → Get API key → Project number. Needed for the Gemini track.
- **Prize tracks** — Gemini, Entire, Tiger Data, Vultr and Auth0 are ticked (the live dashboard sits behind Auth0
  Universal Login). GoDaddy is unticked: no domain, the VM uses sslip.io.
- **Thumbnail and gallery images** — optional; screenshots of a plan card and the dashboard would help.
- Then tick the terms box and press **Submit project**. Submitted projects stay editable until the deadline.

The sections below are what was pasted, kept here as the source of truth.

**Name:** Tether

**Tagline (under 200 characters):**
The operations team that lives in your hackathon's Discord. Agents plan the work across Sheets, Gmail, Calendar and Instagram, and nothing risky happens until a human approves it.

**Links:** Video `<YouTube or Vimeo URL>` · Code `<GitHub URL, the repo is private today>` · Live dashboard https://216-128-176-47.sslip.io/demo/82c2ea79-d419-4817-854d-5b569b0d349b (public read-only view; the signed-in app behind Auth0 is at the root) · Instagram post https://www.instagram.com/p/DfeOMPijoD-/
---

## Inspiration

Organizers run a whole hackathon out of a Discord server, a Google Sheet, a shared calendar and someone's inbox. The work falls through the gaps between them: a sponsor says yes in an email and nobody logs the money, a task goes overdue and nobody chases it, the recap post never gets written because everyone is busy running the event.

We did not want a chatbot that answers questions about the event. We wanted something that does the work, in the place organizers already are, without being trusted to spend money or email a sponsor on its own.

## What it does

You talk to Tether in Discord. It reads the request, or the last few messages of a conversation, and proposes a plan. A person presses Run, and specialist agents do the work.

- **One message, many systems.** "TigerData just confirmed a $1,000 Bronze sponsorship, kick off onboarding" moves the sponsor to confirmed, and that change fires a standing workflow: the income lands on the finance sheet, the deliverables become tasks, and a welcome post is drafted.
- **Plans from a conversation.** `/plan from_chat:5` reads what the team just decided and turns it into calendar events you can edit before anyone approves them.
- **Recaps from real photos.** Drop photos in a channel and ask for a recap. Gemini vision picks the best shots, writes copy that matches them, and the post waits on a card with the gallery attached. Only a lead can publish it to Instagram.
- **Receipts to the books.** Send a receipt photo and finance extracts the amount and tax, stores a durable copy, and logs the expense. Under $50 runs automatically; over that needs a person.
- **Nudges that close the loop.** An overdue task gets a nudge. Reply "tomorrow 3pm" and the due date moves. Reply "can't" and the Lead is pinged to reassign it.
- **Humans stay in charge.** Every step has a card you can edit, approve or reject, and anything running can be stopped with one button. A web dashboard shows the same runs, approvals and goals.

## How we built it

Tether is a TypeScript monorepo. Discord is only an I/O adapter; all the thinking lives in one core package.

- **Durable agent workflows.** A request becomes an Inngest event. The planner drafts a structured plan with dependencies, the executor runs dependency levels in parallel, and each agent loop survives restarts. Waiting on a human is a durable `waitForEvent`, so an approval can arrive hours later and the agent resumes where it stopped.
- **One policy gateway.** Every tool declares its effect and risk, and every side-effecting call passes through `policy.decide()`, which returns run, approve or deny. That rule is enforced in code, not in a prompt, so a model cannot talk its way past it.
- **Gemini** does the planning with structured output, drives six specialist agents with function calling, reads receipts and event photos with vision, classifies nudge replies, summarizes the inbox, and embeds the FAQ.
- **TigerData Postgres** holds everything. The activity stream is a hypertable with columnstore compression and a continuous aggregate that feeds both the dashboard's agent activity chart and the `/tether status` sparkline in Discord, and the helpdesk fuses pgvector similarity with pg_textsearch BM25 using reciprocal rank fusion.
- **Vultr Object Storage** keeps durable copies of receipts and recap photos, because Discord attachment links expire, and staging for Instagram publishing.
- **Next.js dashboard** over the same database, with a plan graph for each run, behind **Auth0** Universal Login: workspace access matches the verified email or Auth0 subject to the team member a lead added from Discord, and an Auth0 roles claim can grant edit rights. It runs on a **Vultr VM** with Docker Compose and Caddy, with Let's Encrypt TLS on an sslip.io hostname. **Entire** recorded our agent sessions, and the commits written with them carry a checkpoint.

## Challenges we ran into

- **Models invent things.** In a live run an agent made up a sponsor's email address, and another made up image URLs. We stopped relying on prompts for this: posting tools now reject images that are not from Discord or our own storage, and email tools refuse an address that differs from the contact on file.
- **Agents asked for approval in prose.** A model would finish with "let me know if you approve" and no card existed, so nothing could ever be approved. Approval now only happens through the card a tool call creates.
- **Free-tier limits.** At 20 requests a day per key on our main model, one multi-step plan could use half the budget. We added per-model key rotation and a fallback model, and rate-limit waits now show on the status card so a slow run does not look like a hung one.
- **Failures that looked like thinking.** When the planner died before a plan existed, Discord kept showing "thinking…" forever. Failed drafts now mark the run and explain themselves in the channel, and errors that retrying cannot fix stop immediately.
- **Our schema tool tried to drop our aggregate.** `drizzle-kit push` issued `DROP VIEW` on the continuous aggregate and still reported success, so we wrote a safer push that refuses to touch protected objects.

## Accomplishments that we're proud of

- The demo is real. Every clip is a live run against real Discord, Google Sheets, Calendar and Instagram, and the post linked above was published by Tether after a lead approved it.
- Reliability work came from actually using it. We ran the flows, wrote down every defect, and fixed the cause rather than the symptom.
- The approval model holds up: agents do the tedious work, and people still make the decisions that matter.

## What we learned

Most of our failures were not about the framework. They were about model discipline: what an agent is allowed to believe, and what must be checked in code rather than requested in a prompt. Durable execution also changed the design more than we expected. Once waiting on a human is cheap, you can put a person in front of every risky action without making the product feel slow.

## What's next for Tether

- A real domain in front of the Vultr VM, and Auth0 Token Vault so each organizer connects their own Google account instead of one shared refresh token.
- An Undo button for executed actions, and an "always allow this" option so trust can grow over time.
- A participant-facing helpdesk channel answering from the event's own documents.
- Write-through to the Sheet for sponsors and tasks.

## Try it yourself

Tether is self-hosted, so you can run it on your own Discord server with your own keys. The minimum is a Discord bot, a free Gemini API key and a Tiger Cloud database; Google, Instagram and Auth0 are optional add-ons. `pnpm env:check` tests each credential with a real call and prints the bot's invite link. The full walkthrough is in the [setup guide](<public repo URL>/blob/main/docs/SELF_HOSTING.md).

## Built with

`typescript` `node.js` `discord.js` `gemini` `inngest` `postgresql` `timescaledb` `tigerdata` `pgvector` `next.js` `hono` `drizzle` `vultr` `google-sheets` `google-calendar` `gmail` `instagram-graph-api` `entire`
