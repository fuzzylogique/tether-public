import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env.js";

let _s3: S3Client | undefined;
function s3() {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_ACCESS_KEY || !e.S3_SECRET_KEY) return undefined;
  if (!_s3) {
    _s3 = new S3Client({
      endpoint: e.S3_ENDPOINT, region: "us-east-1", forcePathStyle: false,
      credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
    });
  }
  return _s3;
}

/** True when Vultr Object Storage keys and a bucket are configured. */
export function storageConfigured(): boolean {
  const e = env();
  return Boolean(s3() && e.S3_BUCKET);
}

/** Public hostname objects are served from (`<bucket>.<region>.vultrobjects.com`), or undefined when unconfigured. */
export function storageHost(): string | undefined {
  const e = env();
  if (!storageConfigured()) return undefined;
  return `${e.S3_BUCKET}.${e.S3_ENDPOINT!.replace(/^https?:\/\//, "")}`;
}

/**
 * Upload to Vultr Object Storage (S3 compatible) and return the public URL.
 * Returns undefined when storage is not configured so callers can fall back to the original URL.
 */
export async function uploadObject(key: string, data: Buffer, contentType: string): Promise<string | undefined> {
  const client = s3();
  const e = env();
  if (!client || !e.S3_BUCKET) return undefined;
  await client.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: data, ContentType: contentType, ACL: "public-read" }));
  return `https://${storageHost()}/${key}`;
}

/** uploadObject with a data-URL fallback so image generation still works in dev without keys. Never store the fallback in a sheet cell. */
export async function putObject(key: string, data: Buffer, contentType: string): Promise<string> {
  return (await uploadObject(key, data, contentType)) ?? `data:${contentType};base64,${data.toString("base64")}`;
}
