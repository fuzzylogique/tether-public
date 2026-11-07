import { EventSchemas, Inngest } from "inngest";
import type { Plan } from "../db/schema.js";

export type Attachment = { url: string; contentType?: string; name?: string };
export type Source = { channelId?: string; messageId?: string; threadId?: string; planMessageId?: string; statusMessageId?: string };

export type Events = {
  "tether/request.received": {
    data: {
      orgId: string;
      trigger: "slash" | "mention" | "thread" | "cron" | "watcher";
      mode: "auto" | "agent";
      agent?: string;
      text: string;
      source: Source;
      actorDiscordId?: string;
      actorName?: string;
      attachments?: Attachment[];
    };
  };
  "tether/plan.decided": { data: { runId: string; approved: boolean; plan?: Plan; deciderDiscordId?: string } };
  "tether/plan.approved": { data: { runId: string } };
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
  "tether/task.overdue": { data: { orgId: string; taskId: string } };
};

export const isInngestDev = process.env.INNGEST_DEV === "1" || process.env.INNGEST_DEV === "true";

export const inngest = new Inngest({
  id: "tether",
  schemas: new EventSchemas().fromRecord<Events>(),
  isDev: isInngestDev,
});
