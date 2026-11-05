import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readMediaBackup, openBackupObject, verifyBackupObject } from "./media-backup-manifest.mjs";

function metadata(item) {
  const result = {};
  if (!item.metadata || typeof item.metadata !== "object" || Array.isArray(item.metadata)) throw Error("Missing metadata");
  for (const [key, value] of Object.entries(item.metadata)) {
    const normalized = key.toLowerCase();
    if (!normalized || Object.hasOwn(result, normalized) || typeof value !== "string" || /[\r\n\0]/.test(key + value)) throw Error("Invalid metadata");
    Object.defineProperty(result, normalized, { value, enumerable: true });
  }
  for (const key of ["contentType", "contentEncoding", "cacheControl", "contentDisposition"]) {
    if (item[key] !== null && (typeof item[key] !== "string" || /[\r\n\0]/.test(item[key]))) throw Error("Invalid object header");
  }
  return result;
}
const sorted = value => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
const send = (client, command) => client.send(command, { abortSignal: AbortSignal.timeout(120000) });

/** Explicit, already-created empty destination only. Never creates or deletes buckets. */
export async function restoreMediaToS3(client, source, bucket) {
  if (!source || !bucket) throw Error("Explicit source and target required");
  const manifest = await readMediaBackup(source);
  if (!manifest.bucket || manifest.bucket === bucket) throw Error("A distinct restore bucket is required");
  // Validate every record and source byte before the first remote write.
  for (const item of manifest.objects) metadata(item);
  for (const item of manifest.objects) await verifyBackupObject(openBackupObject(source, item), item);
  const initial = await send(client, new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if (initial.IsTruncated || initial.Contents?.length) throw Error("Restore target is not empty");
  let total = 0;
  for (const item of manifest.objects) {
    const body = openBackupObject(source, item);
    const expectedMetadata = metadata(item);
    try {
      await send(client, new PutObjectCommand({ Bucket: bucket, Key: item.key, Body: body,
        ContentLength: item.bytes, ContentType: item.contentType ?? "application/octet-stream",
        ContentEncoding: item.contentEncoding ?? undefined, CacheControl: item.cacheControl ?? undefined,
        ContentDisposition: item.contentDisposition ?? undefined, Metadata: expectedMetadata,
        IfNoneMatch: "*",
      }));
    } finally { body.destroy(); }
    const restored = await send(client, new GetObjectCommand({ Bucket: bucket, Key: item.key }));
    if (!restored.Body) throw Error("Missing restored object");
    await verifyBackupObject(restored.Body, item);
    if (restored.ContentLength !== item.bytes || restored.ContentType !== (item.contentType ?? "application/octet-stream") ||
      (restored.ContentEncoding ?? null) !== item.contentEncoding || (restored.CacheControl ?? null) !== item.cacheControl ||
      (restored.ContentDisposition ?? null) !== item.contentDisposition || sorted(restored.Metadata) !== sorted(expectedMetadata)) throw Error("Restored metadata differs");
    total += item.bytes;
  }
  const expected = new Map(manifest.objects.map(item => [item.key, item.bytes]));
  const tokens = new Set();
  let token;
  do {
    const page = await send(client, new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken: token }));
    for (const item of page.Contents ?? []) {
      if (!expected.has(item.Key) || expected.get(item.Key) !== item.Size) throw Error("Unexpected restored inventory");
      expected.delete(item.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && (!token || tokens.has(token))) throw Error("Incomplete restored inventory");
    if (token) tokens.add(token);
  } while (token);
  if (expected.size) throw Error("Incomplete restore");
  return { objects: manifest.objects.length, bytes: total, allRestoredHashesMatch: true, objectMetadataVerified: true, inventoryVerified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let client;
  try {
    const source = process.env.MEDIA_BACKUP_DIRECTORY, bucket = process.env.MEDIA_RESTORE_BUCKET;
    if (!source || !bucket) throw Error("Explicit configuration required");
    client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1", endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: true });
    console.log(JSON.stringify(await restoreMediaToS3(client, source, bucket)));
  } catch {
    console.error("Object-storage restore failed. No complete restore established. Check source, explicit empty target, permissions and conditional-write support; retain partial objects for diagnosis.");
    process.exitCode = 1;
  } finally { client?.destroy(); }
}
