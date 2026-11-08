# Devpost submission draft

**Status (Nov 8, 2026):** the draft exists on Devpost and every text field below is already pasted in.
Edit it at https://devpost.com/submit-to/31951-hacktrent-2026/manage/submissions/1285537-tether/project-overview
(public preview: https://devpost.com/software/tether-yzqh3o). Deadline on the hackathon page: **Nov 8, 2026 @ 11:00am EST**.

**Live deployment (Maira, Nov 7 evening):** https://216-128-176-47.sslip.io on a Vultr VM (2 GB, Docker Compose + Caddy,
Let's Encrypt via sslip.io). The dashboard is up behind her Auth0 tenant; the bot container was down on Nov 8 morning
(`/health` 502). The public `/demo/<org>` view only exists after a redeploy of current `main`; until then that link redirects to the Auth0 login like the root does. Only her SSH key and Vultr account can reach it: to redeploy, she runs
`infra/deploy.sh 216.128.176.47 --bot` (after stopping the laptop bot), or adds another public key to the VM.

Already on Devpost: the story and tagline below, the GitHub link (https://github.com/fuzzylogique/tether-public, a copy of
this branch without the `refs/entire/checkpoints/*` refs; the working repo stays private), all three teammates, and Gemini
project number 111270914618 (the "tether" project in AI Studio). Prize tracks ticked: Gemini, Entire, Tiger Data, Vultr, Auth0.
GoDaddy is unticked: no domain, the VM uses sslip.io.

Still to do on Devpost:
- **Video demo link** (required) — teammate is producing the video; paste the YouTube/Vimeo URL under Project details.
- **Universities** — currently "University of Waterloo" only; add any other teammate's school.
- **Thumbnail and gallery images** — optional; screenshots of a plan card and the dashboard would help.
- Then tick the terms box and press **Submit project**. Submitted projects stay editable until the deadline.

The sections below are what was pasted, kept here as the source of truth.

**Name:** Tether

**Tagline (under 200 characters):**
Manage your socials, emails and budget all from your group chat. Tether is the extra organizer your event always needed, and it checks with you before doing anything big.

**Links:** Video `<YouTube or Vimeo URL>` · Code https://github.com/fuzzylogique/tether-public · Live dashboard https://216-128-176-47.sslip.io/demo/82c2ea79-d419-4817-854d-5b569b0d349b (public read-only view; the signed-in app behind Auth0 is at the root) · Instagram post https://www.instagram.com/p/DfeOMPijoD-/
---

## Inspiration

Running an event is no simple task. Everyone is chatting on Discord while the real work is scattered across a spreadsheet, a shared calendar and somebody's overflowing inbox. A sponsor says yes by email and nobody logs the money. A task quietly goes overdue. The recap post sits on the to-do list until everyone has forgotten what happened.

We didn't want one more chatbot that answers questions about the schedule. We wanted a teammate who picks up the boring jobs right there in the group chat, and who still asks before spending your money or emailing your sponsors.

## What it does

**Manage your socials, emails and budget, all from your group chat.** Tell Tether what's going on in plain English, or point it at the last few messages of your conversation, and it comes back with a plan. Press Run and a small crew of specialist agents gets to work.

- **One piece of good news, everything sorted.** Say "TigerData just confirmed a $1,000 Bronze sponsorship, kick off onboarding." Tether marks the sponsor as confirmed, adds the money to your finance sheet, turns the deliverables into tasks and drafts a welcome post.
- **Your chat becomes your calendar.** Been going back and forth about when to meet? `/plan from_chat:5` reads what you all just decided and turns it into calendar events you can tweak before anything gets added.
- **Event photos become Instagram posts.** Drop your photos in a channel and ask for a recap. Tether picks the best shots, writes a caption to match, and holds the post until a lead gives it the thumbs up.
- **Your sponsor inbox, under control.** Tether watches for sponsor replies, flags them in your sponsorship channel, sends a daily inbox digest, and drafts emails for you to approve before anything goes out.
- **Snap a receipt and the books are done.** Send a photo and Tether reads the amount and tax, saves a copy and logs the expense. Purchases under $50 go straight through, and anything bigger waits for a person.
- **Friendly nagging, on autopilot.** Overdue tasks get a nudge. Reply "tomorrow 3pm" and the due date moves. Reply "can't" and your lead gets pinged to find someone else.
- **You're still the boss.** Every step shows up on a card you can edit, approve or reject, and one button stops anything mid-run. A web dashboard shows your goals, approvals and everything the agents have been up to.

## How we built it

Tether is written in TypeScript. Discord is just the front door, and all the thinking happens in one shared core.

- **Gemini is the brains.** It writes the plans, powers six specialist agents (finance, sponsorship, socials, calendar, coordination and helpdesk), reads receipts and event photos, understands replies like "tomorrow 3pm" and sums up the inbox.
- **Inngest gives Tether patience.** Every plan is a durable workflow, so an approval can arrive hours later and the agents pick up exactly where they left off, even after a restart.
- **One rulebook, written in code.** Every action passes through a single policy check that decides whether to run it, ask a person or refuse. It lives in code rather than in a prompt, so no model can sweet-talk its way past it.
- **TigerData remembers everything.** The agents' activity stream is a compressed hypertable, and a continuous aggregate draws the dashboard's activity chart and the sparkline in `/tether status`. The helpdesk blends pgvector similarity with BM25 keyword search so questions find the right answer.
- **Vultr keeps the lights on.** A VM runs the dashboard with Docker Compose and Caddy. Object Storage holds receipts and photos, because Discord links expire and Instagram needs somewhere to fetch images from.
- **Auth0 minds the door.** The dashboard sits behind Universal Login. Access matches the people a lead adds from Discord, and an Auth0 roles claim can grant edit rights.
- **Entire was our flight recorder.** We built Tether with AI coding agents, and Entire captured those sessions as we went. 57 of our commits link back to the session that wrote them, so we could look up why a change was made as well as what changed. That mattered when several of us were working with agents on the same code over one weekend.

## Challenges we ran into

- **AI makes things up.** During one live run, an agent invented a sponsor's email address. Another invented image URLs. Asking nicely didn't fix it, so now email tools refuse any address that doesn't match the contact on file, and posting tools only accept images from Discord or our own storage.
- **Agents asking permission to no one.** A model would finish with "let me know if you approve" when there was no approval card to press. Now the only way to approve something is the card itself.
- **Living on free-tier limits.** At 20 requests a day per key, one big plan could eat half our budget. We added key rotation and a backup model, and the status card now tells you when Tether is waiting its turn.
- **The bot that was "thinking" forever.** When planning crashed early, Discord kept saying "thinking…" until the end of time. Now failures explain themselves in the channel, and errors that retrying can't fix stop right away.
- **Our database tool tried to delete our chart.** `drizzle-kit push` quietly dropped the view behind our activity chart and still reported success, so we wrote a safer push that won't touch protected objects.

## Accomplishments that we're proud of

- The demo is the real thing. Every clip is a live run against real Discord, Google Sheets, Calendar and Instagram, and [this Instagram post](https://www.instagram.com/p/DfeOMPijoD-/) was published by Tether after a lead approved it.
- We used it until it broke, wrote down everything that went wrong, and fixed the causes.
- The balance feels right: the agents do the tedious bits, and people still make the calls that matter.

## What we learned

Most of our bugs came down to trust: what an agent should be allowed to believe, and what has to be checked in code instead of requested in a prompt. We also learned that when waiting for a human costs nothing, you can ask a person before every risky action and the whole thing still feels quick.

## What's next for Tether

- A proper domain, and Auth0 Token Vault so each organizer can connect their own Google account.
- An Undo button, plus "always allow this" so Tether can earn more trust over time.
- A helpdesk channel where participants get answers straight from the event's own documents.
- Keeping sponsors and tasks in sync with the Google Sheet too.

## Try it yourself

Want Tether in your own group chat? It's self-hosted, so you run it on your own Discord server with your own keys. All you need to start is a Discord bot, a free Gemini API key and a Tiger Cloud database. Google, Instagram and Auth0 are optional extras. The [setup guide](https://github.com/fuzzylogique/tether-public/blob/main/docs/SELF_HOSTING.md) walks you through it.

## Built with

`typescript` `node.js` `discord.js` `gemini` `inngest` `postgresql` `timescaledb` `tigerdata` `pgvector` `next.js` `hono` `drizzle` `vultr` `google-sheets` `google-calendar` `gmail` `instagram-graph-api` `entire`
