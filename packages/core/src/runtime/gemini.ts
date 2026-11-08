import { GoogleGenAI, type Content, type FunctionDeclaration, type Part, type Schema } from "@google/genai";
import { NonRetriableError } from "inngest";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { env } from "../env.js";
import type { Tool } from "../tools/types.js";

/** Every configured key, primary first, de-duplicated. */
export function geminiKeys(): string[] {
  const e = env();
  return [...new Set([e.GEMINI_API_KEY, ...e.GEMINI_API_KEYS.split(",").map((k) => k.trim())].filter(Boolean))];
}

const clients = new Map<string, GoogleGenAI>();
export function ai(apiKey = geminiKeys()[0] ?? "") {
  let c = clients.get(apiKey);
  if (!c) { c = new GoogleGenAI({ apiKey }); clients.set(apiKey, c); }
  return c;
}

// A (model, key) pair that hit its daily quota is skipped for an hour, then tried once more (the quota
// resets at midnight Pacific; one wasted request per hour is cheaper than guessing the reset time).
const exhaustedAt = new Map<string, number>();
const EXHAUSTED_TTL_MS = 60 * 60 * 1000;
const tail = (k: string) => `…${k.slice(-4)}`;

function usableKey(model: string): string | undefined {
  const now = Date.now();
  return geminiKeys().find((k) => {
    const at = exhaustedAt.get(`${model}::${k}`);
    return !at || now - at > EXHAUSTED_TTL_MS;
  });
}

/** Which model and key a call would use right now; `pnpm env:check` and the status card read this. */
export function geminiRoute(model: string): { model: string; key?: string; fallback: boolean } {
  const key = usableKey(model);
  if (key) return { model, key, fallback: false };
  const fb = env().GEMINI_MODEL_FALLBACK;
  const fbKey = fb && fb !== model ? usableKey(fb) : undefined;
  return fbKey ? { model: fb, key: fbKey, fallback: true } : { model, key: undefined, fallback: false };
}

/**
 * Retries 429/503 with exponential backoff and honors "retry in Ns" hints (free-tier Flash is ~20 RPM).
 * A daily-quota 429 rotates to the next configured key for the same model; when every key is exhausted
 * for that model it drops to GEMINI_MODEL_FALLBACK (rotating again), and only then gives up.
 */
export type RetryWait = { model: string; attempt: number; attempts: number; waitMs: number; reason: string };

export async function generateWithRetry(
  params: Parameters<GoogleGenAI["models"]["generateContent"]>[0], attempts = 5,
  opts: { onWait?: (w: RetryWait) => void | Promise<void> } = {},
) {
  let delay = 2000;
  const route = geminiRoute(params.model);
  let model = route.model;
  let key = route.key ?? geminiKeys()[0] ?? "";
  if (route.fallback) console.warn(`[gemini] every key is out of daily quota for ${params.model}; using ${model}`);
  for (let i = 1; ; i++) {
    try {
      return await ai(key).models.generateContent({ ...params, model });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const dailyQuota = /per day/i.test(msg);
      if (dailyQuota) {
        exhaustedAt.set(`${model}::${key}`, Date.now());
        const nextKey = usableKey(model);
        if (nextKey) {
          console.warn(`[gemini] daily quota exhausted for ${model} on key ${tail(key)}; switching to key ${tail(nextKey)}`);
          key = nextKey;
          continue;
        }
        const fallback = env().GEMINI_MODEL_FALLBACK;
        const fbKey = fallback && fallback !== model ? usableKey(fallback) : undefined;
        if (fbKey) {
          console.warn(`[gemini] daily quota exhausted for ${model} on every key; falling back to ${fallback}`);
          model = fallback;
          key = fbKey;
          continue;
        }
        // Daily quota won't recover for hours; an Inngest retry would only burn more requests.
        throw new NonRetriableError(msg, { cause: e });
      }
      const retryable = /"code":(429|503)|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/.test(msg);
      if (!retryable || i >= attempts) throw e;
      const hinted = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
      const wait = hinted ? Math.min(Number(hinted[1]) * 1000 + 500, 60_000) : delay;
      const reason = /RESOURCE_EXHAUSTED|429/.test(msg) ? "rate limited" : "model unavailable";
      // Silent sleeps here looked like a hung run on the status card; say so in the log and to the caller.
      console.warn(`[gemini] ${reason} on ${model} (key ${tail(key)}); retry ${i}/${attempts} in ${Math.round(wait / 1000)}s`);
      await opts.onWait?.({ model, attempt: i, attempts, waitMs: wait, reason })?.catch?.(() => undefined);
      await new Promise((r) => setTimeout(r, wait));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

export function toGeminiSchema(zodSchema: z.ZodTypeAny): Schema {
  const json = zodToJsonSchema(zodSchema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (["$schema", "additionalProperties", "default", "$ref", "definitions"].includes(k)) continue;
        if (k === "exclusiveMinimum") { out.minimum = v; continue; }
        if (k === "exclusiveMaximum") { out.maximum = v; continue; }
        out[k] = clean(v);
      }
      return out;
    }
    return node;
  };
  return clean(json) as Schema;
}

export function toFunctionDeclaration(tool: Tool): FunctionDeclaration {
  return { name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input) };
}

export async function generateStructured<T>(opts: {
  model?: string; system: string; prompt: string; schema: z.ZodType<T, z.ZodTypeDef, unknown>; temperature?: number;
}): Promise<T> {
  const res = await generateWithRetry({
    model: opts.model ?? env().GEMINI_MODEL_AGENT,
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    config: {
      systemInstruction: opts.system,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(opts.schema),
      temperature: opts.temperature ?? 0.2,
    },
  });
  const text = res.text ?? "{}";
  return opts.schema.parse(JSON.parse(text));
}

export async function generateText(opts: { model?: string; system?: string; prompt: string; parts?: Part[] }) {
  const res = await generateWithRetry({
    model: opts.model ?? env().GEMINI_MODEL_AGENT,
    contents: [{ role: "user", parts: [...(opts.parts ?? []), { text: opts.prompt }] }],
    config: { systemInstruction: opts.system },
  });
  return res.text ?? "";
}

export async function embed(text: string): Promise<number[]> {
  const res = await ai(usableKey(env().GEMINI_MODEL_EMBED) ?? geminiKeys()[0]).models.embedContent({
    model: env().GEMINI_MODEL_EMBED,
    contents: text,
    config: { outputDimensionality: 768 },
  });
  return res.embeddings?.[0]?.values ?? [];
}

export async function fetchAsInlineData(url: string, mimeHint?: string): Promise<Part> {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  const mimeType = mimeHint ?? r.headers.get("content-type") ?? "image/jpeg";
  return { inlineData: { mimeType, data: buf.toString("base64") } };
}

export type { Content, Part };

export async function generateStructuredMultimodal<T>(opts: {
  model?: string; system?: string; parts: Part[]; schema: z.ZodType<T, z.ZodTypeDef, unknown>; temperature?: number;
}): Promise<T> {
  const res = await generateWithRetry({
    model: opts.model ?? env().GEMINI_MODEL_AGENT,
    contents: [{ role: "user", parts: opts.parts }],
    config: {
      systemInstruction: opts.system,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(opts.schema),
      temperature: opts.temperature ?? 0,
    },
  });
  return opts.schema.parse(JSON.parse(res.text ?? "{}"));
}
