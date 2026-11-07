import type { Notifier } from "../../tools/types.js";
import { handleRequestFn } from "./requests.js";
import { runPlanFn } from "./plans.js";
import { runAgentStepFn } from "./steps.js";
import { monitorTasksFn, pollSponsorMailFn } from "./monitors.js";
import { env } from "../../env.js";

/** True when this process is the one designated to run the cron monitors (`TETHER_RUN_CRONS=1`). */
export function cronsEnabled() {
  return env().TETHER_RUN_CRONS === "1";
}

export function createTetherFunctions(deps: { notifier: Notifier }) {
  // Every dev server serves /api/inngest against the same shared DB and Gmail account, so the
  // crons are registered on exactly one process. Unset -> the monitors do not exist on this instance.
  return [
    handleRequestFn(deps.notifier), runPlanFn(deps.notifier), runAgentStepFn(deps.notifier),
    ...(cronsEnabled() ? [monitorTasksFn, pollSponsorMailFn] : []),
  ];
}
