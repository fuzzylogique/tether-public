import type { Notifier } from "../../tools/types.js";
import { handleRequestFn } from "./requests.js";
import { runPlanFn } from "./plans.js";
import { runAgentStepFn } from "./steps.js";
import { monitorTasksFn, pollSponsorMailFn } from "./monitors.js";

export function createTetherFunctions(deps: { notifier: Notifier }) {
  return [handleRequestFn(deps.notifier), runPlanFn(deps.notifier), runAgentStepFn(deps.notifier), monitorTasksFn, pollSponsorMailFn];
}
