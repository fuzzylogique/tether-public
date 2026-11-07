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

/** Vultr Object Storage (S3 compatible). Falls back to a data URL when unconfigured so dev still works. */
export async function putObject(key: string, data: Buffer, contentType: string): Promise<string> {
  const client = s3();
  const e = env();
  if (!client || !e.S3_BUCKET) return `data:${contentType};base64,${data.toString("base64")}`;
  await client.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: data, ContentType: contentType, ACL: "public-read" }));
  const host = e.S3_ENDPOINT!.replace("https://", "");
  return `https://${e.S3_BUCKET}.${host}/${key}`;
}
