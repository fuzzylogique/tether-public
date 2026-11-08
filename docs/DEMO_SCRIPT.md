# Tether demo video: script, shot list, lines

Target: 2 minutes 15 seconds. Five screen clips of Discord, one of the dashboard, one of the sheet or calendar, voiceover recorded separately. Everything below was verified live on Nov 8 (see `DEMO_READINESS.md` §1b), so every clip is a real run, not a mock.

## Recording setup (no OBS on this Mac)

- macOS built-in: `Cmd+Shift+5` → "Record Selected Portion" around the Discord window, or from a terminal `screencapture -v -V 90 clip1.mov` records the main display for 90 seconds with no UI.
- Discord: zoom to 110% (`Cmd` and `+`), hide the member list, dark theme, one server. Keep `#socials`, `#finance`, `#sponsorship`, `#calendar` and `#general` pinned at the top of the channel list so cuts between them are short.
- Before recording: `pnpm demo:reset` (reseeds DB and sheet), real photos only in `#photos`, `pnpm env:check` shows `gemini-3.6-flash ✔`, one `pnpm dev:server` running, `/workspace date 2026-11-07 09:00`.
- Record each clip as its own file; the editor cuts the waiting. Expect 20–60 s per run on 3.6-flash. Trim "Working…" down to two seconds in the edit; keep the tool log lines visible for a beat, they are the proof of work.

## Shot list

| # | Clip | What is on screen | Length (edited) |
|---|------|-------------------|-----------------|
| 1 | Cold open | `#general`: type `@tether what's on today and who hasn't paid their sponsorship?` → plan card appears with two steps (calendar, finance) → press **Run** → status card ticks → summary card | 20 s |
| 2 | Sponsorship → finance, one message | `#sponsorship`: `/plan request: TigerData just confirmed a $1,000 Bronze sponsorship, kick off onboarding` → plan card (one outreach step) → **Run** → `⚙️ Sponsor confirmed` workflow card → cut to `#finance`: `log_income` approval card → **Approve** → card flips to executed with the sheet link → cut to `#tasks`: three "TigerData: …" tasks → cut to Google Sheet Income tab with the new row | 35 s |
| 3 | Calendar from a chat | `#general`: two teammates type `judge briefing sunday 9-9:30 in room 204` / `and devpost deadline at 11` → `/plan from_chat:5` → plan card quoting the decisions → **Run** → `#calendar` approval card showing the ISO times → **Edit** modal (show the fields, close it) → **Approve** → activity line with the Google Calendar link → cut to the calendar | 30 s |
| 4 | Recap post to Instagram | Drop two phone photos in `#socials`, then `/post recap brief: Day 1 recap instagram:true` → status card tool log: `list_event_photos → select_recap_photos → generate_post_copy` → Instagram approval card with the photo gallery and "needs lead" → a non-lead clicks Approve and gets "This needs a lead" → the lead approves → card shows the Instagram permalink → cut to the post on instagram.com | 35 s |
| 5 | Stop and control | Start any plan, press **Stop** on the status card → confirm → cards close. Then `/tether policies` (ephemeral) and the approval card footer "risk high · needs lead" | 12 s |
| 6 | Dashboard | `localhost:3000/w/<org>` (or the GoDaddy domain if deployed): countdown, integrations, sponsorship bar, recent agent work; click into a run to show the plan graph | 10 s |
| 7 | Close | `/help` card, one beat, Tether logo | 5 s |

If a run misbehaves on camera, keep rolling: the Stop button and the repaired card are also features.

## Voiceover lines (record separately, one line per clip)

1. "Event organizers run their whole hackathon out of Discord, a Google Sheet and a calendar, and the work falls through the cracks between them. Tether is the operations team that lives in that Discord."
2. "One message. Tether plans the work, and a human presses Run. The outreach agent marks TigerData confirmed, and that single change fires a standing workflow: the income lands on the finance sheet, the deliverables become tasks, and the welcome post is drafted. Money never moves without a card and a button."
3. "The plan can come from the conversation itself. Tether reads the last few messages, writes down what was decided, and the calendar agent books it. Every date is editable before anyone approves it."
4. "Socials: drop the photos, ask for a recap. Gemini vision picks the best shots, writes captions that match them, and the post waits on a card. Only a lead can publish to Instagram, and the bot enforces that, not a prompt."
5. "Anything running can be stopped, any approval can be edited or rejected with a reason, and every tool call passes through one policy gateway that decides run, ask, or deny."
6. "The dashboard shows the same runs, approvals and goals, on a Vultr VM behind a GoDaddy domain, over a TigerData Postgres."
7. "Tether. Durable, human-curated agent workflows for the people who run events."

## Sponsor mentions, where they land naturally

- **Gemini** (clip 4, 2): vision over real photos; structured plans; every agent is a Gemini model.
- **TigerData** (clip 6): hypertable event stream and the hybrid search behind the helpdesk; say "on a TigerData Postgres".
- **Vultr** (clip 4): the photos and receipts are stored in Vultr Object Storage; the card's permalink and the sheet's receipt links prove it.
- **GoDaddy** (clip 6): the domain on the dashboard URL; only if the VM deploy happens.
- **Auth0** (clip 6): the login on the dashboard; same condition.
- **Entire**: say it in the close or a 3-second title card: "built in 36 hours by four people and their Claude sessions, every commit carrying its agent checkpoint through Entire."

## If recording with computer use

The Discord desktop app can be driven, but each run is 20–60 s of waiting, so budget 20 minutes for the five Discord clips. Record with `screencapture -v -V <seconds>` from a shell in the background, drive the clip, let the timer end, repeat. Approvals that need a lead must be clicked by the lead's account (the one signed in).
