import sharp from "sharp";
import { env } from "./env.js";
import { uploadObject } from "./storage.js";

/**
 * Instagram Graph API. Two token kinds work: an Instagram Login token (IGAA…, graph.instagram.com, `/me` is the
 * account) or a Unified/Facebook Login system-user token (EAA…, graph.facebook.com, account id in INSTAGRAM_USER_ID).
 * Publishing is a two-step container flow:
 * create a media container per image (plus a CAROUSEL container for several), wait for FINISHED, then publish.
 * Instagram fetches the images itself, so they must sit at public URLs (our Object Storage bucket).
 */

export type InstagramAccount = { userId: string; username: string; accountType?: string };

const facebookToken = () => env().INSTAGRAM_ACCESS_TOKEN.startsWith("EAA");
const base = () => `https://graph.${facebookToken() ? "facebook" : "instagram"}.com/${env().INSTAGRAM_GRAPH_VERSION}`;

export function instagramConfigured(): boolean {
  return Boolean(env().INSTAGRAM_ACCESS_TOKEN);
}

async function call<T>(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: env().INSTAGRAM_ACCESS_TOKEN });
  const res = method === "GET"
    ? await fetch(`${base()}${path}?${qs}`)
    : await fetch(`${base()}${path}`, { method, body: qs });
  const body = await res.json().catch(() => ({})) as T & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || body.error) throw new Error(`Instagram ${path}: ${body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

let _account: InstagramAccount | undefined;
export async function instagramAccount(): Promise<InstagramAccount> {
  if (!_account && facebookToken()) {
    const id = env().INSTAGRAM_USER_ID;
    if (!id) throw new Error("INSTAGRAM_USER_ID is required with a Facebook Login (EAA…) token");
    const ig = await call<{ id: string; username: string }>("GET", `/${id}`, { fields: "id,username" });
    _account = { userId: ig.id, username: ig.username, accountType: "BUSINESS" }; // only professional accounts reach this API
  } else if (!_account) {
    const me = await call<{ user_id: string; username: string; account_type?: string }>("GET", "/me", { fields: "user_id,username,account_type" });
    _account = { userId: me.user_id, username: me.username, accountType: me.account_type };
  }
  return _account;
}

// Feed images must be JPEG with an aspect ratio between 4:5 and 1.91:1. Carousel items share one frame,
// so they are all cropped to 4:5 portrait; a single image keeps its shape unless it is out of range.
const FEED_MIN_RATIO = 4 / 5;
const FEED_MAX_RATIO = 1.91;

export async function toFeedJpeg(buf: Buffer, opts: { carousel: boolean }): Promise<Buffer> {
  const img = sharp(buf).rotate(); // honour EXIF orientation from phone photos
  if (opts.carousel) return img.resize(1080, 1350, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 88 }).toBuffer();
  const meta = await img.metadata();
  const portrait = (meta.orientation ?? 1) >= 5; // EXIF 5-8 swap width and height
  const w = (portrait ? meta.height : meta.width) ?? 1080;
  const h = (portrait ? meta.width : meta.height) ?? 1080;
  const ratio = Math.min(FEED_MAX_RATIO, Math.max(FEED_MIN_RATIO, w / h));
  const width = Math.min(1440, w);
  return img.resize(width, Math.round(width / ratio), { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 88 }).toBuffer();
}

/** Convert and store each image as a public JPEG. Instagram rejects PNG/WebP and private URLs. */
export async function stageFeedImages(orgId: string, images: Buffer[]): Promise<string[]> {
  const stamp = Date.now();
  const carousel = images.length > 1;
  const urls: string[] = [];
  for (const [i, buf] of images.entries()) {
    const jpeg = await toFeedJpeg(buf, { carousel });
    const url = await uploadObject(`instagram/${orgId}/${stamp}-${i + 1}.jpg`, jpeg, "image/jpeg");
    if (!url) throw new Error("Object Storage is not configured; Instagram needs a public image URL");
    urls.push(url);
  }
  return urls;
}

async function waitFinished(containerId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { status_code } = await call<{ status_code: string }>("GET", `/${containerId}`, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram container ${containerId} is ${status_code}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Instagram container ${containerId} did not finish processing`);
}

/** Publish one image or a carousel (2-10). `imageUrls` must already be public JPEGs (see stageFeedImages). */
export async function publishToInstagram(input: { imageUrls: string[]; caption: string }) {
  const { userId, username } = await instagramAccount();
  const { imageUrls, caption } = input;
  let creationId: string;
  if (imageUrls.length === 1) {
    creationId = (await call<{ id: string }>("POST", `/${userId}/media`, { image_url: imageUrls[0]!, caption })).id;
  } else {
    const children: string[] = [];
    for (const url of imageUrls) {
      const { id } = await call<{ id: string }>("POST", `/${userId}/media`, { image_url: url, is_carousel_item: "true" });
      await waitFinished(id);
      children.push(id);
    }
    creationId = (await call<{ id: string }>("POST", `/${userId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
  }
  await waitFinished(creationId);
  const { id: mediaId } = await call<{ id: string }>("POST", `/${userId}/media_publish`, { creation_id: creationId });
  const { permalink } = await call<{ permalink?: string }>("GET", `/${mediaId}`, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return { mediaId, permalink, username };
}
