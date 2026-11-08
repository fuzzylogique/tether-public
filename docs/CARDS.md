# Cards v2: run control, approvals, and card liveness

Spec for the Discord card interface rework. Companion to `DISCORD_UI.md` (visual system) and
`ARCHITECTURE.md` (pipeline). Status: **agreed 2026-11-07; P1 built the same day (schema pushed,
`handlers.ts` CAS + role checks + in-place repair, `onFailure` orphaning, plan expiry re-render).
P2 built the same day (`run.cancelled` + `cancelOn`, `runtime/cancel.ts`, `runtime/status.ts`, Stop
button with ephemeral confirm, stopped status and summary cards). P3 built the same day (`editFields`
on the gated tools, `runtime/edit.ts`, save-then-approve, reject reason modal, status card waiting
lines with Jump links, `↩ Run` link on approval cards, status card rendered from rows everywhere).
P4 open.** Preview the card states with `pnpm discord:preview -- approval plan status summary`.

Decisions taken: Edit saves and re-renders the pending card; Approve is a separate click.
Assumed defaults, flip them here before P3 if you disagree: Reject opens a modal with one optional
reason; Stop lives on the status card behind an ephemeral confirm and is not on approval cards; role
ranks are enforced at the button.

## 1. Problems this fixes

| # | Symptom | Cause (file) |
|---|---------|--------------|
| 1 | A card still shows Approve/Edit/Reject after its run died; clicking marks it "Approved" and nothing happens | `handlers.ts onButton` only checks `action.status === "pending"`; nothing flips pending actions when `run-agent-step` fails or the run is cancelled |
| 2 | No way to stop a run after Run was pressed | No cancel event; `run-plan` / `run-agent-step` have no `cancelOn`; status card has only a link |
| 3 | Expired plan card keeps live buttons; a late Run marks it "Approved" | `requests.ts` only redraws the status card on expiry; `plan:run` / `plan:cancel` never check `run.status` |
| 4 | Anyone can approve a lead-only action, or edit-and-approve it | `policy.decide()` returns `approverRole` but it is never stored on the action or checked at the click |
| 5 | Card says "Approved" then may never say "executed"/"failed" | Handler renders optimistically, executor renders later; two writers, no ordering |
| 6 | Edit is a JSON textarea for every tool but email, and Edit always approves | `onButton action:edit` |
| 7 | Reject has no reason, so the agent cannot recover sensibly | Modal never shown; `settleAction` already accepts `note` |
| 8 | Status card says "Working…" while a step waits on approval | `plans.ts` redraws from in-memory state at level boundaries only |

## 2. State model

Statuses live in the DB and every card is rendered **from the row**, never from the click.

```
Run:    proposed → approved → running ⇄ awaiting_approval → done | failed | cancelled
                 ↘ cancelled (before Run)   ↘ expired (24h, no decision)
Step:   pending → running ⇄ awaiting_approval → done | failed | cancelled | skipped
Action: pending → approved → executed | failed
                ↘ rejected | expired | cancelled
```

- `approved` on an action is the **transient** "a human said yes, executor has not run yet" state.
  It is set by the button handler with a compare-and-set and cleared by `settleAction`.
- New enum members: `RunStatus` gains `expired`; `StepStatus` and `ActionStatus` gain `cancelled`.
- A card in any terminal state renders with **no interactive buttons**, only link buttons.
- One table in `ui/tokens.ts` maps status → accent, emoji, title word. Builders use it, never
  hard-code colours.

### Card state lines

| State | Top line | Accent |
|-------|----------|--------|
| pending | (none; subtitle says who must approve) | agent colour |
| approved | `⏳ Approved by @x · running \`tool\`…` | amber |
| executed | `✅ Approved by @x · executed <t:R>` | green |
| failed | `❌ Approved by @x, but it failed` + `-# error` | red |
| rejected | `❌ Rejected by @x` + `-# reason` | red |
| expired | `⌛ Expired without a decision` | grey |
| cancelled | `⏹ Run stopped by @x before a decision` | grey |
| edited (still pending) | `✏️ Edited by @x <t:R> · subject, body changed` | agent colour |

## 3. Schema changes

```ts
// actions
approverRole: text("approver_role"),           // "lead" | null, copied from policy.decide()
editedBy: text("edited_by"),                   // discord id of the last editor
editedAt: timestamp("edited_at", { withTimezone: true }),
// runs
cancelledBy: text("cancelled_by"),
// enums
RunStatus    += "expired"
StepStatus   += "cancelled"
ActionStatus += "cancelled"
// events.kind
"run_cancelled" | "action_cancelled" | "action_edited" | "approval_denied_role"
```

Additive only; `pnpm db:push` on the shared DB adds columns and nothing else.

## 4. Events

```ts
"tether/run.cancelled": { data: { runId: string; orgId: string; by: string; byName?: string } };
```

`tether/action.decided` is unchanged. Edits no longer ride on it: an edit is a DB write plus a
re-render, and the later Approve sends `action.decided { approved: true }` with no `editedArgs`
(the row already holds the edited args; `settleAction` uses `action.args`).

## 5. Button and modal ids

| Id | Where | Handler behaviour |
|----|-------|-------------------|
| `action:approve:<actionId>` | approval card | deferUpdate → role check → CAS pending→approved → render "approved" → send `action.decided` |
| `action:edit:<actionId>` | approval card | role check → modal `action:editsubmit:<actionId>` built from `tool.editFields` |
| `action:editsubmit:<actionId>` | modal | validate via `tool.input.parse({...args, ...fields})` → update row (args, editedBy, editedAt) → render pending card with edit line |
| `action:reject:<actionId>` | approval card | modal `action:rejectsubmit:<actionId>` with one optional field `reason` |
| `action:rejectsubmit:<actionId>` | modal | CAS pending→rejected (note=reason) → render → send `action.decided { approved:false, note }` |
| `plan:run:<runId>` / `plan:cancel:<runId>` | plan card | require `run.status === "proposed"` else repair card; otherwise as today |
| `run:stop:<runId>` | status card | permission check → ephemeral "Stop this run? Running tool calls finish, nothing new starts." with `run:stopconfirm:<runId>` |
| `run:stopconfirm:<runId>` | ephemeral | `cancelRun()` (§7) |
| `run:jump:<actionId>` | status card | link button to the approval message (no handler) |

Every handler path that finds the row in a state the button no longer applies to **re-renders the
card from the row** (`interaction.update`) and then replies ephemerally with the reason. That is the
lazy repair for problem 1 and problem 3.

## 6. Permissions at the button

`effectiveRoles(member, org, usersRow)` = `users.roles` ∪ team keys whose Discord role id in
`org.roles` the member holds (`memberRoleIds()` already exists in `handlers.ts`). Rank via
`ROLE_RANK` in `policy/defaults.ts`.

- Approve / Edit / Reject: `hasRole(roles, action.approverRole ?? "organizer")`.
- Stop: requester (`run.actorDiscordId`) or `hasRole(roles, "organizer")`.
- Plan Run / Cancel / toggle: requester or organizer+.
- A refused click leaves the card untouched and replies ephemerally: "This needs a lead. Leads:
  <@&roleId>." The refusal is logged as `approval_denied_role`.

Unknown Discord users resolve to `organizer` today (`loadActor`); that stays, so only high-risk
actions tighten.

## 7. Stop a running run

**Eager cleanup in the adapter, cancellation in Inngest.** The handler does not trust Inngest's
`function.cancelled` system event for cleanup, because the user is looking at the card right now.

`cancelRun({ runId, by, byName, notifier })` in `packages/core/src/runtime/cancel.ts`:

1. `update runs set status='cancelled', cancelledBy where id and status in ('approved','running','awaiting_approval')`; return if nothing updated (already terminal → repair status card).
2. `steps`: running/awaiting_approval → `cancelled`; pending → `skipped`.
3. `actions`: pending → `cancelled`, decidedAt=now. For each with a `messageRef`, `notifier.editMessage` with the cancelled card.
4. `inngest.send("tether/run.cancelled")`.
5. `refreshRunCard(runId)` (status card → "Stopped by @x · n/m steps finished").
6. Post the summary card with status `cancelled` listing steps that finished and **every executed
   side effect** from `actions where run_id and status='executed'`, so people know what did go out.
7. `events`: `run_cancelled`.

Inngest side:

- `run-plan` and `run-agent-step`: `cancelOn: [{ event: "tether/run.cancelled", if: "event.data.runId == async.data.runId" }]`.
  Both are needed: cancelling an invoking parent does not cancel `step.invoke` children.
- `handle-request`'s `.catch` around `step.invoke("execute")` reads `runs.status` first; if it is
  `cancelled` it returns `{ status: "cancelled" }` instead of marking the run failed.
- Semantics stated on the confirm prompt and in the summary: an in-flight tool call completes;
  no new step, LLM turn or tool call starts. No undo.

## 8. Liveness: keeping the DB consistent when a waiter dies

- `run-agent-step` gets `onFailure`: step → `failed`; its pending actions → `expired` with
  `decisionNote: "run failed"`; cards re-rendered; `refreshRunCard`.
- `handle-request` plan expiry: run → `expired`; **plan card re-rendered** (`approvalCard`-style
  decision line "⌛ Expired after 24h"), status card as today.
- Approval expiry already re-renders; keep.
- `refreshRunCard(runId)` (new, `runtime/status.ts`): loads run + steps + pending actions and
  renders the status card from rows. Called from `run-plan` at level boundaries (replacing the
  in-memory `state`), from `run-agent-step` on `mark-running` / `post-approvals` / `finish-step`,
  from `cancelRun`, and from `onFailure`. Status card gains per-step `awaiting approval · 2 cards in
  #finance` with `Jump` link buttons, and the `Stop` button while non-terminal.
- Optional belt-and-braces (P4): cron every 30 min flips actions `pending` older than 25h to
  `expired` and re-renders. The waiters time out at 24h, so anything older has no waiter.

## 9. Approve / Edit / Reject

**Approve.** `deferUpdate()` first (kills the spinner within the 3s window), then role check, then
`update actions set status='approved', approverDiscordId where id and status='pending' returning *`.
Zero rows → load row, repair card, ephemeral "Already decided by @x". One row → render "approved"
state (buttons gone), then `inngest.send(action.decided)`. The executor's re-render in
`run-agent-step` is now the only later writer, so ordering is fixed.

**Edit.** Tools declare their editable surface:

```ts
editFields?: { key: string; label: string; style: "short" | "paragraph"; required?: boolean }[];
```

| Tool | Fields |
|------|--------|
| send_email / create_email_draft | to, cc, subject, body |
| post_announcement | text |
| post_instagram | caption |
| log_expense | amount, category, vendor, description |
| create_event | title, start, end, location |
| nudge_owner / escalate / escalate_to_organizer | message / question |
| anything else | one `args` JSON paragraph (today's fallback) |

Modal submit: merge fields over `action.args` (numbers coerced for `amount`), `tool.input.parse`;
on a Zod error reply ephemerally with the issues and change nothing. On success update the row and
`interaction.update` the pending card with the edit line and the changed-field list. Buttons stay.
Edits are allowed while `pending` only.

**Reject.** Modal with one optional short field "Reason (optional, the agent sees it)". Submit with
it empty = plain reject. CAS pending→rejected, render, send `action.decided { approved:false, note }`.

## 10. Status card as the run's control surface

- Title by run status; `Stop` (danger) while `running` / `awaiting_approval`; `Open run` link.
- Per-step lines from the `steps` table. A step in `awaiting_approval` adds
  `-# waiting on: Send sponsor email (#finance) · Log $1,200 (#finance)` with one `Jump` link
  button per pending action (cap 4, then "+N more").
- Approval cards gain a `↩ Run` link button to the status message (`runs.source.statusMessageId`
  and `channelId` are already stored).
- Approvals stay in team channels (`teamChannelFor`); no threading, no "Approve all".

## 11. Work plan

**P1 Correctness (ship regardless, ~half day)**
1. Schema: new columns and enum members; `db:push`.
2. `loop.ts`: store `approverRole` on the action row.
3. `handlers.ts`: `deferUpdate`, `effectiveRoles`, CAS on approve/reject, status checks on
   `plan:run`/`plan:cancel`, in-place repair on every invalid click.
4. `approval.ts`: `approved` transient state; `plan.ts`: `expired` decision; tokens table.
5. `steps.ts` `onFailure`; `requests.ts` plan expiry re-render.

**P2 Stop (~2h)**
6. `run.cancelled` event, `cancelOn` on both functions, `handle-request` catch.
7. `runtime/cancel.ts` `cancelRun`, `runtime/status.ts` `refreshRunCard`.
8. Status card: Stop button + confirm flow; cancelled summary card.

**P3 UX (~3h)**
9. `editFields` on tools; edit modal from registry; edit-then-approve flow with edit line.
10. Reject-with-reason modal.
11. Status card per-step waiting lines + Jump links; approval card `↩ Run` link; `refreshRunCard`
    wired into `run-plan` and `run-agent-step`.

**P4 Later**
12. Stale-action sweep cron; ping the approver role on high-risk cards; Undo button for tools with
    `undo`.

## 12. Verification

- Automated, `pnpm test` (node:test, no Discord, no database):
  - `apps/server/src/discord/ui/cards.test.ts` renders every fixture in `ui/fixtures.ts` through the
    real Components V2 renderer and diffs the payload JSON against `__snapshots__/<fixture>.json`:
    text, buttons, custom ids, accent, attachment hashes. `UPDATE_SNAPSHOTS=1` accepts a change.
  - `packages/core/src/runtime/{edit,cards,status}.test.ts` cover `applyEdit` coercion and the
    changed-fields list, `settledDecision` for every action status, and `deriveRunStatus`.
  - `packages/core/src/ui/cards/cards.test.ts` pins the button contract: Stop only while `isLiveRun`,
    Approve/Edit/Reject only while pending, `↩ Run` when `context.runUrl` is set.
- Visual, dev guild: `pnpm discord:preview` posts every fixture to #tether-preview. `pnpm discord:compare`
  posts each card twice, the payload an older commit produced and the current one, so a change can be
  eyeballed side by side. Build the baseline by running `cards.test.ts` from the old commit with
  `SNAPSHOT_DIR=apps/server/.preview/baseline UPDATE_SNAPSHOTS=1 SNAPSHOT_FILES=1`.
- Manual, dev guild: approve twice fast (second gets "already decided"); kill `dev:server` mid-wait,
  restart, approve (still executes: Inngest resumes `waitForEvent`); run `/sponsor followup`, press
  Stop while a card is pending (card → "stopped", status → "Stopped", summary lists executed
  effects); let a plan expire with `timeout` temporarily set to 1m (plan card → expired, Run click
  → repaired, not approved); press Approve on a high-risk card without the Lead role (refused,
  card untouched).
- `pnpm typecheck`.
