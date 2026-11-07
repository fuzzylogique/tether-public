import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Tool } from "../tools/types.js";
import { resolveTools } from "../tools/registry.js";

const agentJson = z.object({
  name: z.string(),
  label: z.string(),
  color: z.string(),
  description: z.string(),
  tools: z.array(z.string()),
  maxTurns: z.number().int().min(1).max(20).default(8),
});

export type AgentDef = z.infer<typeof agentJson> & { prompt: string; toolDefs: Tool[] };

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

/**
 * Agent definitions are declarative files. The protected preamble is prepended at runtime
 * (see runtime/loop.ts) and cannot be removed by editing these files.
 */
export function loadAgents(dir = AGENTS_DIR): Record<string, AgentDef> {
  const out: Record<string, AgentDef> = {};
  for (const name of readdirSync(dir)) {
    let raw: string;
    try { raw = readFileSync(join(dir, name, "agent.json"), "utf8"); } catch { continue; }
    const def = agentJson.parse(JSON.parse(raw));
    const prompt = readFileSync(join(dir, name, "prompt.md"), "utf8");
    out[def.name] = { ...def, prompt, toolDefs: resolveTools(def.tools) };
  }
  return out;
}

let cache: Record<string, AgentDef> | undefined;
export function agents(): Record<string, AgentDef> {
  if (!cache) cache = loadAgents();
  return cache;
}
export function reloadAgents() { cache = undefined; return agents(); }
export function agentNames() { return Object.keys(agents()); }
