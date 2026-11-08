import { EventSchemas, Inngest } from "inngest";
import type { Plan } from "../db/schema.js";

export type Attachment = { url: string; contentType?: string; name?: string };
export type Source = { channelId?: string; messageId?: string; threadId?: string; planMessageId?: string; statusMessageId?: string };

export type Events = {
  "tether/request.received": {
    data: {
      orgId: string;
      trigger: "slash" | "mention" | "thread" | "cron" | "watcher" | "dm";
      mode: "auto" | "agent";
      agent?: string;
      text: string;
      /** Extra material for the planner (a chat transcript from `/plan from_chat`). Never shown as the request. */
      context?: string;
      source: Source;
      actorDiscordId?: string;
      actorName?: string;
      attachments?: Attachment[];
    };
  };
  "tether/plan.decided": { data: { runId: string; approved: boolean; plan?: Plan; deciderDiscordId?: string } };
  "tether/plan.approved": { data: { runId: string; attachments?: Attachment[] } };
  "tether/step.requested": {
    data: {
      runId: string; stepId: string; agent: string; instruction: string;
      dependencyOutputs: Record<string, string>;
      actorDiscordId?: string; actorName?: string; attachments?: Attachment[]; sessionThreadId?: string;
    };
  };
  "tether/action.decided": {
    data: { actionId: string; runId: string; approved: boolean; note?: string; editedArgs?: Record<string, unknown>; deciderDiscordId?: string; deciderName?: string };
  };
  /** An organizer pressed Stop on a live run. `run-plan` and `run-agent-step` cancel on it (docs/CARDS.md §7). */
  "tether/run.cancelled": { data: { runId: string; orgId: string; by: string; byName?: string } };
  "tether/task.overdue": { data: { orgId: string; taskId: string } };
  /** A task owner answered a nudge (DM, or a reply to the nudge in #tasks). */
  "tether/nudge.replied": { data: { orgId: string; taskId: string; ownerDiscordId: string; ownerName?: string; text: string; source: Source } };
  /** A standing workflow fired (see workflows/registry.ts). `params` are validated against the template. */
  "tether/workflow.triggered": { data: { orgId: string; name: string; params: Record<string, unknown>; actorDiscordId?: string; actorName?: string; source?: Source } };
};

export const isInngestDev = process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true";

export const inngest = new Inngest({
  id: "tether",
  schemas: new EventSchemas().fromRecord<Events>(),
  isDev: isInngestDev,
});
