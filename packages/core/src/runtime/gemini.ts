import { GoogleGenAI, type Content, type FunctionDeclaration, type Part, type Schema } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { env } from "../env.js";
import type { Tool } from "../tools/types.js";

let _ai: GoogleGenAI | undefined;
export function ai() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  return _ai;
}

/** Gemini accepts an OpenAPI-style subset. Strip what it rejects. */
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
  const res = await ai().models.generateContent({
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
  const res = await ai().models.generateContent({
    model: opts.model ?? env().GEMINI_MODEL_AGENT,
    contents: [{ role: "user", parts: [...(opts.parts ?? []), { text: opts.prompt }] }],
    config: { systemInstruction: opts.system },
  });
  return res.text ?? "";
}

export async function embed(text: string): Promise<number[]> {
  const res = await ai().models.embedContent({
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
  const res = await ai().models.generateContent({
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
