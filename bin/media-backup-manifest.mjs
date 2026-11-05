import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function readMediaBackup(source) {
  const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.objects)) throw Error("Invalid manifest");
  const keys = new Set();
  for (const item of manifest.objects) {
    if (!item || typeof item.key !== "string" || !item.key || item.key.includes("\\") || item.key.includes("\0") ||
      item.key.split("/").some(part => !part || part === "." || part === "..") || keys.has(item.key) ||
      !/^[a-f0-9]{64}$/.test(item.file) || !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
      createHash("sha256").update(item.key).digest("hex") !== item.file) throw Error("Invalid object record");
    keys.add(item.key);
  }
  return manifest;
}

export function openBackupObject(source, item) {
  return createReadStream(resolve(source, item.file), { flags: constants.O_RDONLY | constants.O_NOFOLLOW });
}

export async function verifyBackupObject(body, item) {
  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(body, new Writable({ write(chunk, _encoding, callback) {
    bytes += chunk.length; hash.update(chunk); callback();
  } }), { signal: AbortSignal.timeout(120000) });
  if (bytes !== item.bytes || hash.digest("hex") !== item.sha256) throw Error("Object bytes differ");
}
