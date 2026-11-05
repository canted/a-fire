import { readMediaBackup } from "./media-backup-manifest.mjs";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

try {
  const source = process.env.MEDIA_BACKUP_DIRECTORY;
  const destination = process.env.MEDIA_RESTORE_DIRECTORY;
  if (!source || !destination) throw Error("Explicit source and destination required");
  const root = resolve(destination);
  const manifest = await readMediaBackup(source);
  await mkdir(root, { mode: 0o700 }); // Never restore over an existing store.
  let total = 0;
  for (const item of manifest.objects) {
    const path = resolve(root, item.key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
    await pipeline(
      createReadStream(resolve(source, item.file), { flags: constants.O_RDONLY | constants.O_NOFOLLOW }),
      meter,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
    );
    if (bytes !== item.bytes || hash.digest("hex") !== item.sha256) throw Error("Corrupt backup");
    const persisted = createHash("sha256");
    for await (const chunk of createReadStream(path)) persisted.update(chunk);
    if (persisted.digest("hex") !== item.sha256) throw Error("Restored bytes differ");
    total += bytes;
  }
  console.log(JSON.stringify({ objects: manifest.objects.length, bytes: total, allRestoredHashesMatch: true, originalKeysRestored: true, s3MetadataRestored: false }));
} catch {
  console.error("Local media restore failed. No complete restore established. Check the manifest, source files and new destination; retain partial files for diagnosis.");
  process.exitCode = 1;
}
