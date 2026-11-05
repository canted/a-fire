import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

async function inventory(client, bucket) {
  const objects = new Map();
  const tokens = new Set();
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken: token }), { abortSignal: AbortSignal.timeout(60000) });
    for (const item of page.Contents ?? []) {
      if (typeof item.Key !== "string" || !Number.isSafeInteger(item.Size) || item.Size < 0 || !item.ETag || !item.LastModified || objects.has(item.Key)) throw Error("Invalid inventory");
      objects.set(item.Key, { key: item.Key, bytes: item.Size, etag: item.ETag, modified: item.LastModified.toISOString() });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && (!token || tokens.has(token))) throw Error("Incomplete inventory");
    if (token) tokens.add(token);
  } while (token);
  return [...objects.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

// Reads only. Object keys remain private manifest data, never filesystem paths.
export async function backupMedia(client, bucket, destination) {
  if (!bucket || !destination) throw Error("Explicit bucket and new destination required");
  await mkdir(destination, { mode: 0o700 }); // Existing directories are never reused.
  const startedAt = new Date().toISOString();
  const before = await inventory(client, bucket);
  const records = [];
  for (const item of before) {
    const file = createHash("sha256").update(item.key).digest("hex");
    const signal = AbortSignal.timeout(120000);
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.key, IfMatch: item.etag }), { abortSignal: signal });
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
    if (!response.Body) throw Error("Missing object body");
    await pipeline(response.Body, meter, createWriteStream(join(destination, file), { flags: "wx", mode: 0o600 }), { signal });
    if (bytes !== item.bytes || response.ContentLength !== bytes || response.ETag !== item.etag) throw Error("Object changed or incomplete");
    const sha256 = hash.digest("hex");
    // Reread persisted bytes independently, rather than trusting the write stream.
    const persisted = createHash("sha256");
    for await (const chunk of createReadStream(join(destination, file))) persisted.update(chunk);
    if (persisted.digest("hex") !== sha256) throw Error("Persisted checksum mismatch");
    records.push({ ...item, file, sha256, contentType: response.ContentType ?? null, contentEncoding: response.ContentEncoding ?? null, cacheControl: response.CacheControl ?? null, contentDisposition: response.ContentDisposition ?? null, metadata: response.Metadata ?? {} });
  }
  const after = await inventory(client, bucket);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Inventory changed during backup");
  const manifest = { version: 1, startedAt, completedAt: new Date().toISOString(), bucket, objects: records };
  await writeFile(join(destination, "manifest.pending.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(join(destination, "manifest.pending.json"), join(destination, "manifest.json"));
  return { objects: records.length, bytes: records.reduce((sum, item) => sum + item.bytes, 0), persistedChecksumsVerified: true, inventoryUnchanged: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let client;
  try {
    const bucket = process.env.MEDIA_BACKUP_BUCKET;
    const destination = process.env.MEDIA_BACKUP_DIRECTORY;
    if (!bucket || !destination) throw Error("Missing explicit configuration");
    client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1", endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: true });
    console.log(JSON.stringify(await backupMedia(client, bucket, destination)));
  } catch {
    console.error("Media backup failed. No complete backup established; retain partial files for diagnosis. Check explicit configuration, access, storage space and source changes.");
    process.exitCode = 1;
  } finally {
    client?.destroy();
  }
}
