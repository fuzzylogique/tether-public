import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineTool } from "./types.js";
import { brandKits } from "../db/schema.js";
import { generateWithRetry, generateStructured, generateStructuredMultimodal, type Part } from "../runtime/gemini.js";
import { env } from "../env.js";
import { putObject, uploadObject } from "../storage.js";
import { extensionFor, fetchTrustedMedia, trustedMediaUrl } from "../media.js";

// A model that lost the real URLs between steps invents plausible ones; refuse them at parse time so the
// agent gets "invalid arguments" back instead of a human getting an approval card with a broken gallery.
const storedImageUrl = z.string().url().refine(trustedMediaUrl, { message: "must be a URL returned by select_recap_photos or generate_hero_image (a Discord attachment or Tether's own storage); do not invent URLs" });
import { instagramConfigured, publishToInstagram, stageFeedImages } from "../instagram.js";

const postSchema = z.object({
  headline: z.string().max(60),
  caption: z.string().max(600),
  hashtags: z.array(z.string()).max(8),
  callToAction: z.string().max(80),
  imagePrompt: z.string().describe("Prompt for a hero image with no text in it"),
});

export const generatePostCopy = defineTool({
  name: "generate_post_copy",
  description: "Generate on-brand copy for a social post: headline, caption, hashtags, CTA, and a hero image prompt. Mention the photo captions in the brief when the post uses event photos.",
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
  description: "Generate a hero image for a post using the brand palette, when no event photos are available. Text is NOT rendered in the image. Returns skipped:true when image generation is unavailable; carry on without an image.",
  input: z.object({ prompt: z.string(), aspect: z.enum(["1:1", "9:16", "16:9"]).default("1:1") }),
  effect: "write", risk: "low",
  summarize: (a) => `Generate hero image (${a.aspect})`,
  async execute(args, ctx) {
    const [kit] = await ctx.db.select().from(brandKits).where(eq(brandKits.orgId, ctx.org.id));
    try {
      const res = await generateWithRetry({
        model: env().GEMINI_MODEL_IMAGE,
        contents: `${args.prompt}. Flat, modern poster background, palette ${kit?.primaryColor ?? "#6D5DF6"} and ${kit?.secondaryColor ?? "#0EA5A4"}, no text, no letters, aspect ${args.aspect}.`,
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part?.inlineData?.data) return { skipped: true, reason: "no image returned" };
      const buf = Buffer.from(part.inlineData.data, "base64");
      const key = `posts/${ctx.org.id}/${Date.now()}.png`;
      const url = await putObject(key, buf, part.inlineData.mimeType ?? "image/png");
      return { url, key, bytes: buf.length };
    } catch (e) {
      // Free-tier keys have zero image quota; a missing image must not sink the whole post.
      const reason = e instanceof Error ? e.message.slice(0, 200) : String(e);
      console.warn("[generate_hero_image] skipped:", reason);
      return { skipped: true, reason: `image generation unavailable (${reason})` };
    }
  },
});

export const listEventPhotos = defineTool({
  name: "list_event_photos",
  description: "List the most recent photos the team dropped in the org photos channel (newest first), with who posted each and when. Use before select_recap_photos.",
  input: z.object({ limit: z.number().int().min(1).max(50).default(24) }),
  effect: "read", risk: "low",
  summarize: (a) => `List the last ${a.limit} event photos`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["photos"];
    if (!channelId) return { error: "No photos channel configured. Run `/tether channels` (creates #photos) or `/tether setup photos:#channel`." };
    const images = await ctx.notify.listChannelImages({ channelId, limit: args.limit });
    return {
      channelId, count: images.length,
      photos: images.map((p, i) => ({ n: i + 1, messageId: p.messageId, by: p.authorName, postedAt: p.postedAt, name: p.name, width: p.width, height: p.height, url: p.url })),
    };
  },
});

const recapSchema = z.object({
  picks: z.array(z.object({
    photo: z.number().int().min(1).describe("1-based photo number as labelled in the prompt"),
    caption: z.string().max(140).describe("Short caption for this photo, no hashtags"),
    reason: z.string().max(120).describe("Why it made the cut: energy, faces, composition, tells the story"),
  })),
  skipped: z.string().max(300).default("").describe("What was left out and why, in one sentence"),
});

// Discord's media proxy resizes server-side, so a 6 MB phone photo reaches Gemini as a few hundred KB.
const RECAP_MAX_CANDIDATES = 12;
const RECAP_MAX_INLINE_BYTES = 16 * 1024 * 1024;

export const selectRecapPhotos = defineTool({
  name: "select_recap_photos",
  description: "Look at the recent event photos with vision in ONE call, pick the best few for a recap post, write a caption for each, and store durable copies. Call it once with the brief and the count; omit messageIds unless the organizer named specific photos. Returns the picked photo URLs to pass to post_announcement or post_instagram.",
  input: z.object({
    brief: z.string().describe("What the recap is about and the mood wanted, e.g. 'Day 1 recap: hacking, snacks, late night energy'"),
    count: z.number().int().min(1).max(8).default(4),
    messageIds: z.array(z.string()).optional().describe("Restrict to these photo message ids from list_event_photos"),
  }),
  effect: "write", risk: "low",
  summarize: (a) => `Pick ${a.count} recap photos`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["photos"];
    if (!channelId) return { error: "No photos channel configured. Run `/tether channels` (creates #photos) or `/tether setup photos:#channel`." };
    let images = await ctx.notify.listChannelImages({ channelId, limit: 50 });
    let note: string | undefined;
    if (args.messageIds?.length) {
      // Fewer named photos than picks wanted: judge the whole channel instead of returning a thin or empty pick.
      const named = images.filter((p) => args.messageIds!.includes(p.messageId));
      if (named.length >= args.count) images = named;
      else note = `messageIds matched ${named.length} photo(s), fewer than the ${args.count} wanted, so all recent photos were considered`;
    }
    images = images.slice(0, RECAP_MAX_CANDIDATES);
    if (!images.length) return { error: "No photos found in the photos channel" };

    // Fetch downscaled copies for the model; keep the full-size URL for the post itself.
    const candidates: { image: typeof images[number]; buf: Buffer; mimeType: string }[] = [];
    let inlineBytes = 0;
    for (const image of images) {
      const src = image.proxyUrl ? `${image.proxyUrl}${image.proxyUrl.includes("?") ? "&" : "?"}width=1280&height=1280` : image.url;
      const fetched = await fetchTrustedMedia(src, { maxBytes: 6 * 1024 * 1024, mimeHint: image.contentType });
      if ("error" in fetched) continue;
      if (inlineBytes + fetched.buf.length > RECAP_MAX_INLINE_BYTES) break;
      inlineBytes += fetched.buf.length;
      candidates.push({ image, ...fetched });
    }
    if (!candidates.length) return { error: "Could not fetch any of the photos" };

    const parts: Part[] = [{ text: `Event: ${ctx.org.name}. Brief: ${args.brief}. Pick the best ${Math.min(args.count, candidates.length)} photos for a recap post, best first. Prefer sharp photos with people, energy and variety; avoid near-duplicates and anything unflattering.` }];
    candidates.forEach((c, i) => {
      parts.push({ text: `Photo ${i + 1} (posted by ${c.image.authorName ?? "unknown"})` });
      parts.push({ inlineData: { mimeType: c.mimeType, data: c.buf.toString("base64") } });
    });
    const result = await generateStructuredMultimodal({
      system: "You are a photo editor for a student hackathon's social media. Judge only what is in the photos.",
      parts, schema: recapSchema, temperature: 0.3,
    });

    const picks = [];
    const stamp = Date.now();
    for (const [i, pick] of result.picks.slice(0, args.count).entries()) {
      const c = candidates[pick.photo - 1];
      if (!c) continue;
      // Store a durable copy: Discord attachment URLs are signed and expire.
      let url = c.image.url;
      let storage: "vultr-object-storage" | "discord-cdn" = "discord-cdn";
      try {
        const full = await fetchTrustedMedia(c.image.url, { maxBytes: 25 * 1024 * 1024, mimeHint: c.image.contentType });
        const data = "error" in full ? { buf: c.buf, mimeType: c.mimeType } : full;
        const stored = await uploadObject(`recap/${ctx.org.id}/${stamp}-${i + 1}.${extensionFor(data.mimeType)}`, data.buf, data.mimeType);
        if (stored) { url = stored; storage = "vultr-object-storage"; }
      } catch (e) {
        console.warn("[select_recap_photos] object storage upload failed, keeping Discord URL:", e instanceof Error ? e.message : e);
      }
      picks.push({ url, caption: pick.caption, reason: pick.reason, credit: c.image.authorName, sourceMessageId: c.image.messageId, storage });
    }
    return { picks, candidates: candidates.length, skipped: result.skipped, ...(note ? { note } : {}) };
  },
});

export const postAnnouncement = defineTool({
  name: "post_announcement",
  description: "Post text with up to four images to the org announcements channel. Pass the picked recap photo URLs as imageUrls.",
  input: z.object({
    text: z.string(),
    imageUrl: storedImageUrl.optional().describe("Single image (hero image)"),
    imageUrls: z.array(storedImageUrl).max(4).optional().describe("Up to four images, e.g. recap photos"),
  }),
  effect: "external", risk: "medium",
  editFields: [{ key: "text", label: "Post text", style: "paragraph", required: true }],
  summarize: (a) => `Post announcement: ${a.text.slice(0, 80)}`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["announcements"];
    if (!channelId) return { error: "no announcements channel configured" };
    const urls = [...(args.imageUrl ? [args.imageUrl] : []), ...(args.imageUrls ?? [])].slice(0, 4);
    const attachments: { name: string; data: Buffer }[] = [];
    const failed: string[] = [];
    for (const [i, url] of urls.entries()) {
      const fetched = await fetchTrustedMedia(url, { maxBytes: 25 * 1024 * 1024 });
      if ("error" in fetched) { failed.push(`${url}: ${fetched.error}`); continue; }
      attachments.push({ name: `post-${i + 1}.${extensionFor(fetched.mimeType)}`, data: fetched.buf });
    }
    const posted = await ctx.notify.postToChannel({ channelId, text: args.text, attachments: attachments.length ? attachments : undefined });
    return { ...posted, images: attachments.length, ...(failed.length ? { failedImages: failed } : {}) };
  },
});

export const postInstagram = defineTool({
  name: "post_instagram",
  description: "Publish a feed post to the org's Instagram account: one image, or a carousel of 2-10 (e.g. the picked recap photos). Images are converted to JPEG and cropped to Instagram's frame automatically. The caption is the full post text, hashtags included.",
  input: z.object({
    caption: z.string().max(2200).describe("Full caption: copy, call to action, then hashtags (30 at most)"),
    imageUrls: z.array(storedImageUrl).min(1).max(10).describe("Recap photo URLs from select_recap_photos, or the hero image URL"),
  }),
  effect: "external", risk: "high",
  editFields: [{ key: "caption", label: "Caption", style: "paragraph", required: true }],
  summarize: (a) => `Publish to Instagram (${a.imageUrls.length === 1 ? "1 photo" : `${a.imageUrls.length}-photo carousel`}): ${a.caption.slice(0, 70)}`,
  async execute(args, ctx) {
    if (!instagramConfigured()) return { error: "Instagram is not connected (INSTAGRAM_ACCESS_TOKEN is unset)" };
    if ((args.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) return { error: "Instagram allows at most 30 hashtags" };
    const images: Buffer[] = [];
    for (const url of args.imageUrls) {
      const fetched = await fetchTrustedMedia(url, { maxBytes: 25 * 1024 * 1024 });
      if ("error" in fetched) return { error: `${url}: ${fetched.error}` };
      images.push(fetched.buf);
    }
    const staged = await stageFeedImages(ctx.org.id, images);
    const posted = await publishToInstagram({ imageUrls: staged, caption: args.caption });
    return { ...posted, images: staged.length };
  },
});

export const socialsTools = [generatePostCopy, generateHeroImage, listEventPhotos, selectRecapPhotos, postAnnouncement, postInstagram];
