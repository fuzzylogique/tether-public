/**
 * Editing a pending action from its approval card (docs/CARDS.md §9). The modal is derived from the
 * tool's `editFields`; the text that comes back is coerced to the arg's Zod type and the whole input is
 * re-validated, so an edit can never put arguments past the tool's own schema.
 */
import { z } from "zod";
import type { EditField, Tool } from "../tools/types.js";

/** Tools with no declared fields get the whole argument object as one JSON field. */
export const JSON_FIELD: EditField = { key: "args", label: "Arguments (JSON)", style: "paragraph", required: true };

/** Discord modals take five inputs at most. */
export function editFieldsFor(tool: Tool | undefined): EditField[] {
  return (tool?.editFields?.length ? tool.editFields : [JSON_FIELD]).slice(0, 5);
}

/** The current value of an arg as modal text. Arrays join on ", "; objects fall back to JSON. */
export function fieldValue(args: Record<string, unknown>, key: string): string {
  if (key === JSON_FIELD.key) return JSON.stringify(args, null, 2);
  const v = args[key];
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let t = s;
  while (t instanceof z.ZodOptional || t instanceof z.ZodNullable || t instanceof z.ZodDefault) t = t._def.innerType as z.ZodTypeAny;
  return t;
}

/** Modal text → the arg's type. Empty text clears an optional arg (`undefined`), so the field is dropped. */
function coerce(schema: z.ZodTypeAny | undefined, raw: string): unknown {
  const t = raw.trim();
  if (t === "") return undefined;
  if (!schema) return t;
  const inner = unwrap(schema);
  if (inner instanceof z.ZodNumber) { const n = Number(t.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : t; }
  if (inner instanceof z.ZodBoolean) return /^(true|yes|y|1)$/i.test(t);
  if (inner instanceof z.ZodArray) return t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return t;
}

export type EditResult =
  | { ok: true; args: Record<string, unknown>; changed: string[] }
  | { ok: false; error: string };

/** Merge the modal's fields over the action's args and validate against the tool's input schema. */
export function applyEdit(tool: Tool, args: Record<string, unknown>, fields: Record<string, string>): EditResult {
  let next: Record<string, unknown>;
  if (JSON_FIELD.key in fields) {
    try { next = JSON.parse(fields[JSON_FIELD.key]!) as Record<string, unknown>; } catch { return { ok: false, error: "That is not valid JSON." }; }
    if (!next || typeof next !== "object" || Array.isArray(next)) return { ok: false, error: "Arguments must be a JSON object." };
  } else {
    const shape = tool.input instanceof z.ZodObject ? (tool.input.shape as Record<string, z.ZodTypeAny>) : {};
    next = { ...args };
    for (const [key, raw] of Object.entries(fields)) {
      const v = coerce(shape[key], raw);
      if (v === undefined) delete next[key]; else next[key] = v;
    }
  }
  const parsed = tool.input.safeParse(next);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `**${i.path.join(".") || "input"}**: ${i.message}`).join("\n") };
  }
  const final = parsed.data as Record<string, unknown>;
  // Compare against the original run through the same schema so defaults do not read as edits.
  const base = tool.input.safeParse(args);
  const before = (base.success ? base.data : args) as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(final)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(final[k]));
  return { ok: true, args: final, changed };
}
