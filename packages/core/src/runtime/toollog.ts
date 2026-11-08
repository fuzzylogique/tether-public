/**
 * The per-step tool log on the status card (docs/GUIDE.md §5) is read from `tool_call` events, so the
 * short argument shown on each line is computed here, once, when the event is written.
 */

/** The first string-valued argument, trimmed to one line of at most 40 characters. */
export function shortArg(args: Record<string, unknown>): string | undefined {
  for (const v of Object.values(args)) {
    if (typeof v !== "string") continue;
    const line = v.replace(/\s+/g, " ").trim();
    if (!line) continue;
    return line.length > 40 ? `${line.slice(0, 39)}…` : line;
  }
  return undefined;
}

/** `tool_call` event payload: what the card needs, plus the raw args for the dashboard. */
export function toolCallEvent(input: { tool: string; args: Record<string, unknown>; stepId?: string; error?: string }) {
  return { tool: input.tool, args: input.args, stepId: input.stepId, summary: shortArg(input.args), error: input.error };
}
