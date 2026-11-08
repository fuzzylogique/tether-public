import { z } from "zod";
import { sql } from "drizzle-orm";
import { defineTool } from "./types.js";
import { embed } from "../runtime/gemini.js";

export const searchDocs = defineTool({
  name: "search_docs",
  description: "Hybrid (vector + keyword) search over the org's FAQ, schedule, rules, and past emails.",
  input: z.object({ query: z.string(), limit: z.number().max(10).default(5) }),
  effect: "read", risk: "low",
  summarize: (a) => `Search docs: ${a.query}`,
  async execute(args, ctx) {
    const vec = await embed(args.query);
    const vecLiteral = `[${vec.join(",")}]`;
    // Reciprocal rank fusion of vector similarity and pg_textsearch BM25. `<@>` is negative for a match
    // and 0 for a document sharing no terms, so the filter keeps non-matches out of the keyword ranking.
    const bm25 = sql`content <@> to_bm25query(${args.query}, 'documents_bm25_idx')`;
    const rows = await ctx.db.execute(sql`
      with v as (
        select id, row_number() over (order by embedding <=> ${vecLiteral}::vector) as r
        from documents where org_id = ${ctx.org.id} and embedding is not null limit 20
      ), k as (
        select id, row_number() over (order by ${bm25}) as r
        from documents where org_id = ${ctx.org.id} and ${bm25} < 0 limit 20
      ), fused as (
        select id, sum(1.0/(60+r)) as score from (select * from v union all select * from k) u group by id
      )
      select d.id, d.kind, d.title, left(d.content, 1200) as content, f.score
      from fused f join documents d on d.id = f.id
      order by f.score desc limit ${args.limit}
    `);
    return rows;
  },
});

export const escalateToOrganizer = defineTool({
  name: "escalate_to_organizer",
  description: "Forward a participant question the docs cannot answer to the help channel for an organizer.",
  input: z.object({ question: z.string(), context: z.string().optional() }),
  effect: "external", risk: "low",
  editFields: [{ key: "question", label: "Question", style: "paragraph", required: true }, { key: "context", label: "Context", style: "paragraph" }],
  summarize: (a) => `Escalate question: ${a.question.slice(0, 80)}`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["ops"];
    if (!channelId) return { error: "no ops channel configured" };
    return ctx.notify.postToChannel({ channelId, text: `❓ **Unanswered participant question**\n> ${args.question}${args.context ? `\n_${args.context}_` : ""}` });
  },
});

export const helpdeskTools = [searchDocs, escalateToOrganizer];
