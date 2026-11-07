import { storageHost } from "./storage.js";

/** Hosts the agents may fetch images from: Discord attachments and our own Object Storage bucket. */
export const DISCORD_MEDIA_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

export function trustedMediaUrl(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname; } catch { return false; }
  const own = storageHost();
  return DISCORD_MEDIA_HOSTS.includes(host) || (!!own && host === own);
}

export type FetchedMedia = { buf: Buffer; mimeType: string };

/**
 * Fetch an image the model or a tool named. Refuses untrusted hosts (SSRF) and oversized bodies.
 * Returns an error string instead of throwing so tools can hand it back to the agent.
 */
export async function fetchTrustedMedia(url: string, opts: { maxBytes?: number; mimeHint?: string } = {}): Promise<FetchedMedia | { error: string }> {
  if (!trustedMediaUrl(url)) return { error: "Images must be Discord attachments or already stored by Tether" };
  const res = await fetch(url);
  if (!res.ok) return { error: `Could not fetch the image (HTTP ${res.status})` };
  const buf = Buffer.from(await res.arrayBuffer());
  const max = opts.maxBytes ?? 10 * 1024 * 1024;
  if (buf.length > max) return { error: `Image is larger than ${Math.round(max / 1024 / 1024)} MB` };
  const mimeType = res.headers.get("content-type")?.split(";")[0] || opts.mimeHint || "image/jpeg";
  return { buf, mimeType };
}

export function extensionFor(mimeType: string): string {
  return (mimeType.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
}
