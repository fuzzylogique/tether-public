# Discord UI: from plain embeds to a visual, from-scratch design system

Scoping document for the implementation session. Written 2026-11-07 against the working tree at
`5133b17` plus the uncommitted team-channel work (`apps/server/src/discord/teams.ts`, `feed.ts`).
Read `docs/ARCHITECTURE.md` first; nothing here changes the pipeline, only how it looks.

## 1. Goal and the one hard constraint

Make every message Tether posts look like a designed product surface: colour, structure, charts,
images and identity, instead of a single `EmbedBuilder` with a markdown blob in the description.

**Hard constraint from the owner: no visual-rendering plugin as a dependency.** Nothing like
`discord-canvas`, `canvacord`, `chartjs-node-canvas`, `quickchart`, Chart.js, D3, satori or any
"pretty embed" helper. Everything that decides what a card or chart looks like is written in this
repo. The only thing we are allowed to lean on is a pixel encoder, because Discord cannot display
SVG inline and a PNG has to come from somewhere. See §6 for the three options and the
recommendation. **Decided 2026-11-07: option A, `@resvg/resvg-js`.**

Everything in §4 and §5 (native Discord layout) needs zero new dependencies: the installed
`discord.js@14.28.1` / `@discordjs/builders@1.15.0` already ship the Components V2 builders.

## 2. What the bot sends today (inventory)

All Discord output goes through two files. Every surface below is either an `EmbedBuilder` with a
markdown description or a plain `content` string.

| # | Surface | Where it is built | Today |
|---|---|---|---|
| 1 | Plan card | `apps/server/src/discord/embeds.ts` `planEmbed` + `notifier.ts` `planComponents` | One embed: quoted request, `☑ **1. Agent** 🔒` lines, footer with run id. Select menu + Run/Edit/Cancel. Re-rendered on select, edit, run, cancel. |
| 2 | Status card (live) | `embeds.ts` `statusEmbed`, edited in place by `DiscordNotifier.updateStatus` | Colour by status, `⬜/⏳/✅/❌ **Agent** — instruction` lines. Driven from `packages/core/src/inngest/functions/plans.ts` `renderStatus`. |
| 3 | Approval cards | `embeds.ts` `approvalEmbed` + `notifier.ts` `approvalComponents` | Email: To/Subject/body text. Everything else: a raw JSON code block (REVIEW.md item 9). Approve/Edit/Reject. After a decision only the `content` line changes. |
| 4 | Run summary | `DiscordNotifier.postSummary` from `plans.ts` | Plain `content`: `**Agent**\n<model output>` per step, cut at 1900 chars. |
| 5 | Activity feed | `packages/core/src/runtime/feed.ts` `postActivity` → `postToChannel` | One line per executed side effect in the team channel: `💸 Log $84 to Food · by Fayez · <sheet url>`. |
| 6 | Tier 0 results | `handlers.ts` `onCommand` for `/budget summary`, `/sponsor list`, `/task list`, `/cal today` | `resultEmbed` with a markdown list. Budget already draws a unicode `█░` bar per category. |
| 7 | Tool-posted messages | `coordination.ts` `nudge_owner` / `escalate`, `helpdesk.ts` `escalate_to_organizer`, `socials.ts` `post_announcement` | Plain text with an emoji prefix; announcement attaches the hero PNG. |
| 8 | Admin replies | `handlers.ts` `onTether` (`setup`, `channels`, `links`, `policies`, `status`) + `teams.ts` `linksText` pinned message | Plain text / markdown bullets, mostly ephemeral. |
| 9 | DMs | `DiscordNotifier.dm` | Plain text. |
| 10 | Reminders | `steps.ts` 2-hour approval reminder → `postToChannel` | Plain text. |

Colour today: `TETHER_COLOR = 0x6d5df6`, per-agent `color` in `packages/core/agents/*/agent.json`
(finance `#1D9E75`, outreach `#7F77DD`, socials `#D4537E`, calendar `#378ADD`, coordination
`#EF9F27`, helpdesk `#888780`), status colours in `statusEmbed`
(running `#EF9F27`, done `#1D9E75`, failed `#E24B4A`, cancelled `#888780`). The web dashboard
(`apps/web/components/ui.tsx`, `plan-graph.tsx`) uses the same palette via CSS variables. Keep all
of these; they become the design tokens.

Data that is already chartable with no new tools: `budget_summary` rows (allocated / spent / pct
per category), `list_sponsors` (stage, amount, tier, deliverables done/total, last contact),
`list_tasks` (status, owner, due, overdue flag), `list_events` (start/end/location),
`runs`/`steps` (status, timings), and the Tiger continuous aggregate `agent_activity_hourly`
(`packages/core/sql/tiger.sql`, currently queried by nothing).

## 3. Target: what "significantly more aesthetic" means here

Four levers, in order of payoff per hour. Phases in §8 follow this order.

1. **Layout** — Discord Components V2 (containers with an accent bar, sections with thumbnails,
   separators, media galleries). This alone turns every surface from "one embed" into a card with
   structure. Zero deps.
2. **Charts** — our own tiny SVG chart library (donut, horizontal bars, funnel, timeline strip,
   step graph, sparkline), rasterised to PNG and attached. Discord shows the PNG inline in a media
   gallery, so a `/budget summary` reply is a real chart, not `█░` glyphs.
3. **Images we already have** — hero images from `generate_hero_image` previewed inside the
   approval card; receipt photos as a thumbnail on finance cards; task owners' Discord avatars as
   section thumbnails; the org logo from `brand_kits.logo_url`.
4. **Identity** — application emojis for agents and statuses (uploaded once by a script, no guild
   emoji slots used), bot avatar and banner, and optionally webhook personas so Finance, Outreach,
   Socials etc. post into their team channels under their own name and avatar colour.

Non-goals: redesigning the web dashboard (it can reuse the SVG charts inline, which is a free
bonus), changing any agent prompt, touching the policy engine, or the Discord slash command set.

## 4. Discord primitives available, and their limits

Verified against the installed packages, not from memory:

- `MessageFlags.IsComponentsV2` (`discord-api-types@0.38.57`, value 32768). When set, the message
  may not carry `content` or `embeds`; everything is `components`.
- Builders present in `@discordjs/builders@1.15.0`: `ContainerBuilder` (`setAccentColor`,
  `addTextDisplayComponents`, `addSectionComponents`, `addSeparatorComponents`,
  `addMediaGalleryComponents`, `addFileComponents`, `addActionRowComponents`), `SectionBuilder`
  (1–3 `TextDisplayBuilder` + `setThumbnailAccessory` or `setButtonAccessory`),
  `TextDisplayBuilder` (markdown, validator caps content at 4000 chars), `SeparatorBuilder`
  (`setSpacing`, `setDivider`), `MediaGalleryBuilder` / `MediaGalleryItemBuilder` (`setURL`,
  description ≤ 1024), `ThumbnailBuilder`, `FileBuilder`, and `LabelBuilder` for V2 modals.
- Media URLs accept `http:`, `https:` and **`attachment:`** (validator at builders `dist/index.js`
  ~line 2522), so a PNG we generate is attached via `files: [AttachmentBuilder]` and referenced as
  `attachment://budget.png` from a gallery or thumbnail.
- Discord-side limits to respect (from the official docs, re-check the "components/overview" page
  when implementing): 40 components per message counting nested ones; 4000 characters total across
  all text displays in one message; 1–10 items per media gallery; a section has at most 3 text
  displays and exactly one accessory.
- Markdown still works inside text displays, including `-# subtext`, `<t:unix:R>` timestamps,
  `<@id>` mentions, `<#id>` channels, headers `#`/`##`/`###`, and code blocks. Keep the
  `allowedMentions: { parse: [] }` habit from `teams.ts` on anything informational.
- Application emojis: `client.application.emojis.create({ attachment, name })`
  (`ApplicationEmojiManager` in discord.js typings). Usable by this app in every guild; no guild
  slot consumed. Render as `<:name:id>` in text.
- Webhooks: `TextChannel.createWebhook({ name, avatar })` then `webhook.send({ username,
  avatarURL, components, flags, files })`. Needs the **Manage Webhooks** permission (the bot
  already needs Manage Channels for `/tether channels`, same settings page).
- Gotchas to design around:
  - Editing a V2 message that references `attachment://x.png` drops the file unless the edit
    re-sends `files` (or keeps `attachments: [{ id }]`). The live status card edits every level
    change, so either re-attach the step-graph PNG on every edit, or keep the status card text-only
    and put the graph on the plan card and the final summary. Recommendation: text-only live
    status, graph on plan + summary.
  - Interaction replies (`i.reply`, `i.editReply`, `i.update`) accept `flags` and `components` the
    same way; `ephemeral` becomes `flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2`.
  - Light theme exists. Containers and accent bars adapt automatically; our PNGs do not. §7
    chooses a background that reads well in both.
  - Mobile renders galleries full-width and thumbnails small (~80px). Design charts at 2× scale
    with ≥ 24px type so they survive the downscale.
  - `ansi` code blocks give coloured monospace text with zero images (useful for a compact
    "diff" of edited approval args). Desktop renders them; confirm on the owner's phone before
    relying on it.

## 5. Architecture: semantic cards in core, pixels at the edge

CLAUDE.md invariant: no Discord or HTTP code in `packages/core`. So the split is:

```
packages/core/src/ui/            pure TypeScript, zero deps, reusable by apps/web
  tokens.ts                      palette, agent colours, status colours, spacing, font name
  card.ts                        the Card model (below) + helpers (fmtMoney, rel time, truncate)
  charts/
    svg.ts                       tiny SVG string builder: rect, roundRect, arc/donut path, text,
                                 line/polyline, group, defs; escapes text; fixed viewBox at 2×
    donut.ts  bars.ts  funnel.ts  timeline.ts  stepGraph.ts  sparkline.ts
    index.ts                     ChartSpec union → svg string
  cards/                         one builder per surface, returns a Card from domain data
    plan.ts status.ts approval.ts summary.ts activity.ts budget.ts sponsors.ts tasks.ts
    calendar.ts nudge.ts escalation.ts helpdesk.ts links.ts

apps/server/src/discord/ui/
  render.ts                      Card → { components, files, flags } using Components V2 builders
  raster.ts                      svg string → PNG Buffer (the one place the encoder is imported)
  emoji.ts                       app-emoji registry: name → "<:name:id>", loaded at startup
  persona.ts                     optional webhook-per-agent sender for team channels
  preview.ts                     `pnpm discord:preview` posts every card with fixture data
apps/server/assets/
  fonts/Inter-Regular.ttf Inter-SemiBold.ttf (SIL OFL, vendored)   emoji/*.png (agent + status icons)
```

The `Card` model (in core) is what every surface produces and what tests/preview render:

```ts
type Card = {
  accent?: string;                     // hex; container accent bar
  title?: string;                      // rendered as "## title" text display
  subtitle?: string;                   // "-# subtitle"
  blocks: Block[];
  actions?: Action[][];                // rows of buttons / selects, same ids as today
  footer?: string;                     // "-# footer"
};
type Block =
  | { kind: "text"; md: string }
  | { kind: "kv"; rows: [label: string, value: string][] }      // rendered as aligned md lines
  | { kind: "section"; md: string[]; thumb?: Media; button?: Action }
  | { kind: "gallery"; items: Media[] }                         // 1–10
  | { kind: "chart"; spec: ChartSpec; name: string; alt: string } // rasterised at the edge
  | { kind: "separator"; divider?: boolean; large?: boolean }
  | { kind: "file"; name: string; data: Buffer };
type Media = { url: string } | { name: string; data: Buffer };    // url or attachment://
```

`Notifier` (`packages/core/src/tools/types.ts`) gains a `card` form alongside `text`:
`postToChannel({ channelId, card })`, `postSummary({ run, card })`, `updateStatus({ run, card })`,
`postPlanCard`, `postApprovalCards` all take Cards built by `core/ui/cards/*`. Keep the `text`
form working so nothing breaks mid-migration. `DiscordNotifier` becomes: build Card → `render()`
→ `channel.send`. The adapter stays "I/O only".

Why SVG strings and not a canvas API: the same string renders inline in the Next dashboard
(`dangerouslySetInnerHTML` or a tiny `<Svg>` component), so charts are written once; SVG is
trivially snapshot-testable as text; and the rasteriser is swappable (§6) without touching chart
code.

## 6. The one dependency question: turning SVG into PNG

Discord does not render SVG attachments. Three ways to get a PNG, all keep the chart logic ours:

| Option | What it is | Deps | Risk | Effort |
|---|---|---|---|---|
| **A. `@resvg/resvg-js`** (recommended) | Rust SVG rasteriser with prebuilt binaries incl. `linux-musl` for the Alpine Docker image. Fonts loaded from files we vendor (`loadSystemFonts: false, fontFiles: [...]`), so output is identical on macOS dev and the Vultr box. | one package in `apps/server` only | low; well-known, deterministic | ~20 min to wire |
| B. `sharp` | Already in the tree as Next's dependency (`sharp@0.35.5`) but **not** in `apps/server`; libvips renders SVG via librsvg and needs fontconfig + a font installed in the Alpine image (`apk add font-inter` or a `fonts.conf` pointing at vendored TTFs). | one package in `apps/server` + Dockerfile font step | medium; font setup is the classic "works on my Mac" trap | ~45 min incl. Docker |
| C. Pure TypeScript rasteriser | Our own scanline polygon filler with 4× supersampling, PNG encoder on `node:zlib` (built in), and a from-scratch TrueType parser (`cmap`, `loca`, `glyf`, `hmtx`; quadratic outlines → polygons) reading the vendored Inter TTF. Donuts, bars, rounded rects, lines and text are all polygons. | **none** | high for a two-day hackathon: ~600–900 lines, hinting-free text looks slightly soft, emoji impossible | 4–6 h, stretch only |

Decision (owner, 2026-11-07): **A**, with C listed as a stretch if the owner wants the
zero-dependency story on stage. The owner's "from scratch" constraint is read as "the visual
system is ours"; a rasteriser is infrastructure like `zlib`. Keep the import in exactly one file
(`raster.ts`) so swapping A → C is a one-file change.

Dockerfile note for A: `@resvg/resvg-js` publishes `@resvg/resvg-js-linux-x64-musl`; add it to
`pnpm.onlyBuiltDependencies` only if pnpm complains (it ships prebuilt, no build step). Vendored
fonts must be copied into the server image (`COPY apps/server/assets apps/server/assets` is
already covered by `COPY apps/server apps/server`).

## 7. Design system (tokens live in `core/ui/tokens.ts`)

- **Accent per context**: agent colour on anything an agent produced (plan steps, approvals,
  activity, summaries); status colour on lifecycle cards (running amber, done teal, failed red,
  cancelled grey); Tether purple `#6D5DF6` for system/admin cards.
- **Chart canvas**: solid rounded card background `#1E1F22` (Discord dark "tertiary") with
  text `#F2F3F5`, muted `#949BA4`, grid `#3F4147`, 2× pixel scale (e.g. wide charts 1200×520,
  square 800×800, strip 1200×220). A dark card reads as intentional in light theme; a transparent
  PNG with white text does not. One render, both themes.
- **Typography**: Inter (already the `brand_kits.font_family` default). Sizes at 2×: 44 title,
  30 value, 26 label, 22 caption. Never under 22px at 2×.
- **Data colours**: categorical series use the six agent colours in order, which keeps charts
  and the dashboard consistent; thresholds reuse `Bar` in `apps/web/components/ui.tsx`
  (> 80 % amber, > 95 % red).
- **Text layout rules**: title as `## `, one-line context as `-# `, key/value rows as
  `**Label**  value` with two spaces, lists ≤ 8 rows then "+N more", every id shortened to 8 chars
  in a footer, timestamps always `<t:…:R>`.
- **Emoji**: app emojis `tether_finance`, `tether_outreach`, `tether_socials`, `tether_calendar`,
  `tether_coordination`, `tether_helpdesk` (16-colour flat glyphs on the agent colour),
  `tether_running`, `tether_done`, `tether_failed`, `tether_locked`, `tether_pending`. Generated
  as 128×128 PNGs by the same SVG pipeline and uploaded by `pnpm discord:emoji` (idempotent by
  name). Fallback to unicode when the registry is empty so dev without the script still works.

## 8. Surface by surface: target design

Each item names the Card builder in `core/ui/cards/` and what changes for the user.

1. **Plan card** (`plan.ts`) — container, accent Tether purple. Header `## Plan · summary`,
   `-# requested by @name · <t:R>`, blockquote of the request. Then one **section per step**:
   `**1. Finance** 🔒 _after 2_` + instruction, with the agent app emoji in the text and a
   per-step toggle button accessory (`plan:toggle:<runId>:<stepId>`, Secondary/Success style
   mirrors enabled state) — this replaces the select menu as the primary control; keep the select
   for mobile users, below. A **step-graph chart** (levels as columns, nodes in agent colours,
   lock badge for approvals, dashed for disabled) as a gallery image. Footer row: Run / Edit steps /
   Cancel. On decision the card re-renders with a green/grey accent and `Approved by name`.
2. **Status card** (`status.ts`) — accent by status, text-only (no files, so edits are cheap).
   `## Working…` / `## Done` / `## Failed`, a progress line `▰▰▰▱▱ 3/5 steps`, one line per step
   with status emoji, agent emoji, label and `<t:R>` when finished. `plans.ts` currently builds
   markdown lines; change it to pass `{ steps: [{ agent, instruction, status, finishedAt }] }`
   and let the card builder format.
3. **Approval cards** (`approval.ts`) — accent agent colour, one renderer per tool (this folds in
   REVIEW.md item 9):
   - `send_email` / `create_email_draft`: kv rows To, Cc (always shown, "none" if empty), Subject,
     thread id if replying; body in a blockquote; `-# risk high · needs lead`.
   - `post_announcement`: copy as text, hero image as a **gallery** (download `imageUrl` once;
     it is already fetched at execute time in `socials.ts`), target channel mention.
   - `log_expense`: kv Amount, Category, Vendor, Date; receipt image as a **thumbnail accessory**
     when `receiptUrl` is set; a mini bar "Food $1,850 → $1,934 of $4,000" as a text line.
   - `create_event`: kv When (two `<t:F>` stamps), Where, attendees count; a conflicts line if
     `find_conflicts` ran (optional, only if the arg is present).
   - `nudge_owner` / `escalate`: the message in a blockquote and the target mention.
   - fallback: kv rows for every top-level arg (strings/numbers inline, objects as a short JSON
     block). Never hide an arg.
   - After decision: edit the same message to `✅ Approved by name · executed <t:R>` or
     `❌ Rejected`, keep the body, remove buttons. Add an **Undo** button when the tool has
     `undo` (coordination create_task, calendar create_event, finance log_expense); wiring undo
     is a 30-minute follow-up in `steps.ts`/`loop.ts` and can be a separate PR.
4. **Run summary** (`summary.ts`) — accent by outcome; one section per step with agent emoji and
   the model output (markdown), separators between; a final gallery with the step graph coloured
   by outcome. If a step's output references budget/sponsor/task numbers, nothing special; the
   Tier 0 charts cover those.
5. **Activity feed** (`activity.ts`) — compact container, accent agent colour, single section
   `💸 **Log $84.20 to Food** · by Fayez` with a small Open-in-Sheet link button accessory. Posted
   via the agent's webhook persona when enabled (§9), so the channel reads as "Finance: …".
6. **Tier 0 results** — the headline charts:
   - `/budget summary` (`budget.ts`): gallery with a **donut** (spent vs remaining, centre label
     "$2,910 of $11,600") beside **horizontal bars** per category (threshold colours), then kv
     rows for totals and `-# synced from sheet <t:R>` with a sheet link button.
   - `/sponsor list` (`sponsors.ts`): **funnel** chart (lead → contacted → replied → negotiating →
     confirmed, declined aside) with count and $ per stage; one section per sponsor with stage
     emoji, amount, tier, last contact `<t:R>`, and a deliverables ring `2/3` rendered as text
     (`●●○`); stale (> 5 days) highlighted amber.
   - `/task list` (`tasks.ts`): status bar (todo / in progress / blocked / done counts as one
     stacked bar image or text `▰`), then sections grouped Overdue / Today / Later with the
     owner's **avatar as thumbnail** (`user.displayAvatarURL()` fetched in the handler, best
     effort) and a `✓ Done` button accessory that calls `update_task` through the normal
     policy path (new button id `task:done:<id>`, low-risk write, runs without a card).
   - `/cal today` (`calendar.ts`): **timeline strip** image (hour axis for the org day, event
     blocks in Tether purple, "now" marker), then one line per event with `<t:t>` times, room,
     and a Google Calendar link button.
7. **Tool-posted messages** — nudges and escalations become small cards with the owner mention in
   text (mentions inside V2 text displays do ping), amber/red accent, task title in a section with
   a `Mark done` button. Helpdesk escalation: question in a blockquote, `Answer in thread` button
   that opens a thread on the message (handler already has thread code for `/agent`).
8. **Admin** — `/tether links` and the pinned links message become a card with one section per
   resource (Calendar / Sheet / Drive) each with a link button accessory, and the team channel
   list. `/tether status` becomes a list of runs with status emoji and a `Open run` link to
   `WEB_PUBLIC_URL/runs/<id>` (REVIEW.md asks for dashboard links on every embed; add the same
   link button to plan, status and summary cards).
9. **DMs and reminders** — same card renderer; V2 works in DMs. Low priority.

## 9. Identity (Phase 3)

- `pnpm discord:emoji`: generates the 11 emoji PNGs from SVG, uploads/updates application emojis,
  writes nothing to disk at runtime; `emoji.ts` fetches the registry once at `ClientReady`.
- Bot avatar and banner: generate a 512×512 avatar (Tether mark on purple) and a 1024×? banner
  with the same pipeline; set via `client.user.setAvatar` / `setBanner` from the same script
  (guarded, runs once).
- Webhook personas (optional, behind `TETHER_PERSONAS=1`): `persona.ts` creates one webhook per
  team channel named "Tether" on first use and stores ids in `orgs.channels` under
  `webhook:<key>`; `postToChannel` with `{ as: agent }` sends through it with
  `username: agents()[agent].label` and an avatar PNG per agent (hosted on Vultr Object Storage via
  `putObject`, falling back to the bot avatar). Result: `#finance` shows messages from "Finance"
  with a green avatar. Needs Manage Webhooks; degrade silently to the bot identity if missing.

## 10. Implementation phases and estimates

Today is 2026-11-07 (day 1 of 2). Phases are ordered so each one ships on its own.

| Phase | Scope | Est. | Done when |
|---|---|---|---|
| 0 | `core/ui/tokens.ts`, `card.ts`, `apps/server/src/discord/ui/render.ts`, `preview.ts` + `pnpm discord:preview` posting one of each card from fixtures into a `#tether-preview` channel in `DISCORD_DEV_GUILD_ID`. Notifier accepts `card` alongside `text`. | 1.5 h | preview channel shows a V2 container with accent, section + thumbnail, separator, buttons; typecheck green. |
| 1 | Migrate surfaces 1–5 (plan, status, approvals per tool, summary, activity). `plans.ts` passes structured step state. Decision re-render on approval cards. | 2.5 h | Demo 2 end-to-end renders only cards; no `EmbedBuilder` left in the run lifecycle. |
| 2 | `charts/svg.ts` + donut, bars, funnel, timeline, stepGraph; `raster.ts` with option A; vendored Inter; wire into budget, sponsors, tasks, calendar, plan, summary. | 3 h | `/budget summary` shows a donut + bars image; `/cal today` a timeline; plan card a step graph. PNG ≤ 150 KB each. |
| 3 | Emoji script + registry, bot avatar/banner, owner avatars on tasks, hero/receipt previews, dashboard link buttons. | 1.5 h | Agent emoji appear in every card; socials approval shows the hero image. |
| 4 (optional) | Webhook personas; `task:done` and `Answer in thread` buttons; Undo button. | 1.5 h | `#finance` messages come from "Finance". |
| Stretch | Activity sparkline from `agent_activity_hourly` on `/tether status`; `ansi` diff of edited args; pure-TS rasteriser (option C). | — | — |

Order inside a phase: fixtures and preview first, then the real wiring, because the preview is
how the result is checked without running Inngest and Gemini.

## 11. Verification plan

- `pnpm discord:preview` is the acceptance tool: it posts every card type with fixture data (the
  seed values in `packages/core/src/db/seed.ts` are fine) to the preview channel and also writes
  each chart as `.svg` and `.png` into `apps/server/.preview/` (gitignored) for a quick look.
  Screenshots of the preview channel on desktop dark, desktop light and phone are the review
  artefact for each phase.
- `pnpm typecheck` before every commit (project rule).
- Unit-free but testable: chart builders are pure `spec → svg string`; add a `pnpm --filter
  @tether/core test:charts` script (plain `node --test`) that snapshots the SVG of each fixture so
  regressions show up as a diff. No test framework needed.
- Live check at the end: run Demo 2 from `docs/ARCHITECTURE.md` and confirm plan → status →
  approval → summary render as cards and that editing the status card does not drop anything.

## 12. Risks and open decisions

1. **Rasteriser choice** (§6): decided, `@resvg/resvg-js`. Keep the import in `raster.ts` only.
2. **Components V2 limits** could bite the plan card on large plans (6 steps × section + buttons
   is ~20 components, fine; 10 steps would not be). Cap step sections at 8 and fall back to a text
   list past that.
3. **Status card edits**: keep text-only (no `attachment://`) so in-place edits never lose files.
4. **Webhooks need a permission** the bot may not have in the judges' guild; the feature must
   degrade to normal bot messages with no error.
5. **Unicode fallbacks** must stay in place for every app emoji so a fresh dev setup renders
   correctly before `pnpm discord:emoji` has run.
6. **Working-tree collision**: `handlers.ts`, `commands.ts`, `teams.ts`, `feed.ts`,
   `coordination.ts`, `loop.ts` are modified and uncommitted right now (team-channel work). Branch
   from the current tree, keep the Notifier text path intact, and touch `handlers.ts` only in the
   Tier 0 `case` bodies and the button router.
7. **Light theme**: the chosen dark chart canvas is a deliberate trade; if it looks wrong in the
   owner's light-mode screenshots, render two PNGs and pick by… nothing, Discord does not tell the
   bot the viewer's theme. Accept the dark card.
8. Discord docs are the source of truth for exact limits; `@discordjs/builders` only validates
   per-component lengths. Read https://discord.com/developers/docs/components/overview once
   before Phase 0.
