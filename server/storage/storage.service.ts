import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { addAbortSignal, Readable } from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageRange = { start: number; end: number };
type StorageStream = { stream: NodeJS.ReadableStream; byteSize?: number };

const S3_TRANSIENT_ATTEMPTS = 3;
const S3_TRANSIENT_RETRY_DELAY_MS = 100;

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly localRoot = process.env.UPLOADS_STORAGE_ROOT ?? path.join(process.cwd(), "storage");
  private readonly bucket = process.env.AWS_S3_BUCKET ?? "afire";
  private readonly backend =
    process.env.UPLOADS_STORAGE_BACKEND ?? (process.env.NODE_ENV === "production" ? "s3" : "local");
  private readonly useS3 = this.backend === "s3";
  private client: S3Client | null = null;

  onModuleDestroy() {
    this.client?.destroy();
  }

  private s3Client(): S3Client {
    return this.client ??= new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
          }
        : undefined,
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Buffer, contentType?: string | null, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.useS3) {
      await this.sendS3((client) =>
        client.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType ?? undefined,
        }), signal ? { abortSignal: signal } : undefined),
        signal,
      );
      return;
    }

    await this.publishLocal(key, temporaryPath => fs.writeFile(temporaryPath, body, { signal, flag: "wx" }), signal);
  }

  async putFile(key: string, filePath: string, contentType?: string | null, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.useS3) {
      const stats = await fs.stat(filePath);
      await this.sendS3(async (client) => {
        const body = createReadStream(filePath);
        // Observe stream errors even if the request fails before the SDK consumes it.
        const closed = finished(body).catch(() => undefined);
        try {
          await client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentLength: stats.size,
            ContentType: contentType ?? undefined,
          }), signal ? { abortSignal: signal } : undefined);
        } finally {
          body.destroy();
          await closed;
        }
      }, signal);
      return;
    }

    await this.publishLocal(key, temporaryPath => pipeline(createReadStream(filePath), createWriteStream(temporaryPath, { flags: "wx" }), { signal }), signal);
  }

  /** Stage on the same filesystem; only a complete object becomes visible. */
  private async publishLocal(key: string, write: (temporaryPath: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
    const destination = path.join(this.localRoot, key);
    const directory = path.dirname(destination);
    await fs.mkdir(directory, { recursive: true });
    const staging = await fs.mkdtemp(path.join(directory, ".afire-write-"));
    const temporaryPath = path.join(staging, "object");
    try {
      await write(temporaryPath);
      signal?.throwIfAborted();
      await fs.rename(temporaryPath, destination);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async getStream(key: string, range?: StorageRange | null, signal?: AbortSignal): Promise<StorageStream> {
    signal?.throwIfAborted();
    if (this.useS3) {
      const response = await this.sendS3((client) =>
        client.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end}` : undefined,
        }), signal ? { abortSignal: signal } : undefined),
        signal,
      );
      if (!response.Body) throw new Error("Missing body");
      const stream = response.Body as Readable;
      if (signal) addAbortSignal(signal, stream);
      return { stream, byteSize: response.ContentLength };
    }

    const filePath = path.join(this.localRoot, key);
    const stats = await fs.stat(filePath);
    return { stream: createReadStream(filePath, { ...range, signal }), byteSize: range ? range.end - range.start + 1 : stats.size };
  }

  async getStreamIfExists(key: string): Promise<StorageStream | null> {
    try {
      return await this.getStream(key);
    } catch (error) {
      if (isS3NotFoundError(error) || (error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw error;
    }
  }

  async getBuffer(key: string, signal?: AbortSignal): Promise<Buffer> {
    const { stream } = await this.getStream(key, undefined, signal);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async exists(key: string): Promise<boolean> {
    if (this.useS3) {
      try {
        await this.sendS3((client) => client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })));
        return true;
      } catch (error) {
        if (!isS3NotFoundError(error)) throw error;
        return false;
      }
    }

    try {
      await fs.access(path.join(this.localRoot, key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return false;
    }
  }

  async getSize(key: string): Promise<number | null> {
    if (this.useS3) {
      try {
        const response = await this.sendS3((client) => client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })));
        return typeof response.ContentLength === "number" ? response.ContentLength : null;
      } catch (error) {
        if (!isS3NotFoundError(error)) throw error;
        return null;
      }
    }

    try {
      const stats = await fs.stat(path.join(this.localRoot, key));
      return stats.size;
    } catch {
      return null;
    }
  }

  async getSignedUrl(key: string): Promise<string | null> {
    if (!this.useS3) return null;
    const client = this.s3Client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 60 * 5 });
  }

  async delete(key: string): Promise<void> {
    if (this.useS3) {
      await this.sendS3((client) => client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })));
      return;
    }

    await fs.rm(path.join(this.localRoot, key), { force: true });
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }

  private async sendS3<T>(operation: (client: S3Client) => Promise<T>, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= S3_TRANSIENT_ATTEMPTS; attempt += 1) {
      try {
        signal?.throwIfAborted();
        return await operation(this.s3Client());
      } catch (error) {
        lastError = error;
        if (!isTransientStorageError(error) || attempt === S3_TRANSIENT_ATTEMPTS) break;
        await delay(S3_TRANSIENT_RETRY_DELAY_MS * attempt, undefined, { signal });
      }
    }

    throw lastError;
  }
}

function isS3NotFoundError(error: unknown) {
  const details = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    details?.name === "NotFound" ||
    details?.name === "NoSuchKey" ||
    details?.Code === "NoSuchKey" ||
    details?.$metadata?.httpStatusCode === 404
  );
}

function isTransientStorageError(error: unknown) {
  const details = error as { code?: string; name?: string } | null;
  const code = details?.code ?? details?.name;
  return (
    code === "CERT_HAS_EXPIRED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED"
  );
}
