import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineTool } from "./types.js";
import { brandKits } from "../db/schema.js";
import { ai, generateStructured } from "../runtime/gemini.js";
import { env } from "../env.js";
import { putObject } from "../storage.js";

const postSchema = z.object({
  headline: z.string().max(60),
  caption: z.string().max(600),
  hashtags: z.array(z.string()).max(8),
  callToAction: z.string().max(80),
  imagePrompt: z.string().describe("Prompt for a hero image with no text in it"),
});

export const generatePostCopy = defineTool({
  name: "generate_post_copy",
  description: "Generate on-brand copy for a social post: headline, caption, hashtags, CTA, and a hero image prompt.",
  input: z.object({ brief: z.string(), platform: z.enum(["instagram", "linkedin", "twitter", "discord"]).default("instagram") }),
  effect: "read", risk: "low",
  summarize: (a) => `Generate ${a.platform} post copy`,
  async execute(args, ctx) {
    const [kit] = await ctx.db.select().from(brandKits).where(eq(brandKits.orgId, ctx.org.id));
    return generateStructured({
      system: `You write social copy for ${ctx.org.name}. Tone: ${kit?.tone ?? "energetic, friendly, concise"}. Platform: ${args.platform}. Never invent dates or sponsor names not in the brief.`,
      prompt: args.brief,
      schema: postSchema,
      temperature: 0.7,
    });
  },
});

export const generateHeroImage = defineTool({
  name: "generate_hero_image",
  description: "Generate a hero image for a post using the brand palette. Text is NOT rendered in the image; it is overlaid later.",
  input: z.object({ prompt: z.string(), aspect: z.enum(["1:1", "9:16", "16:9"]).default("1:1") }),
  effect: "write", risk: "low",
  summarize: (a) => `Generate hero image (${a.aspect})`,
  async execute(args, ctx) {
    const [kit] = await ctx.db.select().from(brandKits).where(eq(brandKits.orgId, ctx.org.id));
    const res = await ai().models.generateContent({
      model: env().GEMINI_MODEL_IMAGE,
      contents: `${args.prompt}. Flat, modern poster background, palette ${kit?.primaryColor ?? "#6D5DF6"} and ${kit?.secondaryColor ?? "#0EA5A4"}, no text, no letters, aspect ${args.aspect}.`,
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData?.data) return { error: "no image returned" };
    const buf = Buffer.from(part.inlineData.data, "base64");
    const key = `posts/${ctx.org.id}/${Date.now()}.png`;
    const url = await putObject(key, buf, part.inlineData.mimeType ?? "image/png");
    return { url, key, bytes: buf.length };
  },
});

export const postAnnouncement = defineTool({
  name: "post_announcement",
  description: "Post text (and optional image URL) to the org announcements channel.",
  input: z.object({ text: z.string(), imageUrl: z.string().url().optional() }),
  effect: "external", risk: "medium",
  summarize: (a) => `Post announcement: ${a.text.slice(0, 80)}`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["announcements"];
    if (!channelId) return { error: "no announcements channel configured" };
    let attachments: { name: string; data: Buffer }[] | undefined;
    if (args.imageUrl) {
      const r = await fetch(args.imageUrl);
      attachments = [{ name: "post.png", data: Buffer.from(await r.arrayBuffer()) }];
    }
    return ctx.notify.postToChannel({ channelId, text: args.text, attachments });
  },
});

export const socialsTools = [generatePostCopy, generateHeroImage, postAnnouncement];
