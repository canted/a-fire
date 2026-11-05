import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/** Only disposable synthetic data is written. Retain the probe object for inspection. */
export async function checkConditionalPut(client, bucket) {
  if (!bucket) throw Error("Explicit disposable probe bucket required");
  const send = command => client.send(command, { abortSignal: AbortSignal.timeout(30000) });
  const initial = await send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if (initial.IsTruncated || initial.Contents?.length) throw Error("Probe bucket must be empty");
  const Key = `afire-conditional-write-probe/${randomUUID()}`;
  const put = Body => new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType: "text/plain", IfNoneMatch: "*" });
  await send(put("original synthetic probe"));
  let rejected = false;
  try { await send(put("replacement synthetic probe")); }
  catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412) throw Error("Conditional rejection not established");
    rejected = true;
  }
  const response = await send(new GetObjectCommand({ Bucket: bucket, Key }));
  if (!response.Body) throw Error("Probe read-back missing");
  // Bound the response even if an incompatible endpoint returns unexpected data.
  let body = "";
  const timer = setTimeout(() => response.Body.destroy?.(Error("Probe read timed out")), 30000);
  try {
    for await (const chunk of response.Body) {
      body += Buffer.from(chunk).toString("utf8");
      if (body.length > 1024) throw Error("Probe read-back exceeds limit");
    }
  } finally { clearTimeout(timer); response.Body.destroy?.(); }
  if (!rejected || body !== "original synthetic probe") throw Error("Provider does not enforce conditional create");
  return { conditionalCollisionRejected: true, originalPreserved: true, syntheticProbeRetained: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let client;
  try {
    const bucket = process.env.MEDIA_RESTORE_PROBE_BUCKET;
    if (!bucket || bucket === process.env.MEDIA_RESTORE_BUCKET) throw Error("Separate explicit probe bucket required");
    client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1", endpoint: process.env.AWS_ENDPOINT_URL_S3, forcePathStyle: true });
    console.log(JSON.stringify(await checkConditionalPut(client, bucket)));
  } catch {
    console.error("Conditional-write compatibility not established. Do not restore to this provider. Retain the disposable probe object for inspection.");
    process.exitCode = 1;
  } finally { client?.destroy(); }
}
