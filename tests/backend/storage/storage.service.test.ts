import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { vi } from "vitest";
import { StorageService } from "@server/storage/storage.service";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = sendMock;
  }
  class GetObjectCommand {
    constructor(public input: any) {}
  }
  class PutObjectCommand {
    constructor(public input: any) {}
  }
  class HeadObjectCommand {
    constructor(public input: any) {}
  }
  class DeleteObjectCommand {
    constructor(public input: any) {}
  }
  return {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("signed-url"),
}));

describe("StorageService (local)", () => {
  const root = path.join(process.cwd(), "tmp-storage-tests");

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    process.env.UPLOADS_STORAGE_BACKEND = "local";
    process.env.UPLOADS_STORAGE_ROOT = root;
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("does not report a local permission failure as a missing object", async () => {
    const service = new StorageService();
    const denied = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    const access = vi.spyOn(fs, "access").mockRejectedValueOnce(denied);
    try { await expect(service.exists("uploads/object")).rejects.toBe(denied); }
    finally { access.mockRestore(); }
  });

  it("puts, checks, gets, and deletes files", async () => {
    const service = new StorageService();
    const key = "uploads/test.txt";

    await service.put(key, Buffer.from("hello"), "text/plain");
    expect(await service.exists(key)).toBe(true);
    expect(await service.getSize(key)).toBe(5);

    const buffer = await service.getBuffer(key);
    expect(buffer.toString()).toBe("hello");

    const sourcePath = path.join(root, "source.txt");
    await fs.writeFile(sourcePath, "from-file");
    await service.putFile("uploads/from-file.txt", sourcePath, "text/plain");
    const fileBuffer = await service.getBuffer("uploads/from-file.txt");
    expect(fileBuffer.toString()).toBe("from-file");

    await service.delete(key);
    expect(await service.exists(key)).toBe(false);
  });

  it("returns nulls for missing files", async () => {
    const service = new StorageService();
    expect(await service.exists("missing.txt")).toBe(false);
    expect(await service.getSize("missing.txt")).toBeNull();
    expect(await service.getSignedUrl("missing.txt")).toBeNull();
  });
});

describe("StorageService (s3)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.UPLOADS_STORAGE_BACKEND = "s3";
    process.env.AWS_S3_BUCKET = "bucket";
    process.env.AWS_REGION = "us-east-1";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("handles s3 operations", async () => {
    const { HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const service = new StorageService();

    sendMock.mockResolvedValueOnce({}); // put
    await service.put("key.txt", Buffer.from("ok"), "text/plain");
    expect(sendMock).toHaveBeenCalledWith(expect.any(PutObjectCommand), undefined);

    const sourcePath = path.join(process.cwd(), "tmp-storage-s3-put-file.txt");
    await fs.writeFile(sourcePath, "file");
    try {
      sendMock.mockResolvedValueOnce({}); // putFile
      await service.putFile("file.txt", sourcePath, "text/plain");
      const putFileCommand = sendMock.mock.calls.at(-1)?.[0] as { input?: Record<string, unknown> };
      expect(putFileCommand).toBeInstanceOf(PutObjectCommand);
      expect(putFileCommand.input).toEqual(
        expect.objectContaining({
          Bucket: "bucket",
          Key: "file.txt",
          ContentLength: 4,
          ContentType: "text/plain",
        }),
      );
      expect(putFileCommand.input?.Body).toBeDefined();
    } finally {
      await fs.rm(sourcePath, { force: true });
    }

    sendMock.mockResolvedValueOnce({ ContentLength: 4 }); // exists
    await expect(service.exists("key.txt")).resolves.toBe(true);
    expect(sendMock).toHaveBeenCalledWith(expect.any(HeadObjectCommand));

    sendMock.mockResolvedValueOnce({ ContentLength: 9 }); // size
    await expect(service.getSize("key.txt")).resolves.toBe(9);

    sendMock.mockResolvedValueOnce({ Body: Readable.from("data") }); // getStream
    const buffer = await service.getBuffer("key.txt");
    expect(buffer.toString()).toBe("data");

    await expect(service.getSignedUrl("key.txt")).resolves.toBe("signed-url");
    expect(getSignedUrl).toHaveBeenCalled();

    sendMock.mockResolvedValueOnce({}); // delete
    await service.delete("key.txt");
    expect(sendMock).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
  });

  it("closes each file stream before retrying a failed upload", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-storage-retry-"));
    const source = path.join(root, "source");
    const bodies: Readable[] = [];
    await fs.writeFile(source, "fixture");
    sendMock.mockImplementation(async (command: { input: { Body: Readable } }) => {
      if (bodies.length) expect(bodies[0].destroyed).toBe(true);
      bodies.push(command.input.Body);
      if (bodies.length === 1) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return {};
    });
    try {
      await new StorageService().putFile("output", source);
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).not.toBe(bodies[1]);
      expect(bodies.every(body => body.destroyed)).toBe(true);
    } finally {
      sendMock.mockReset();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns false/null when s3 head reports missing objects", async () => {
    const service = new StorageService();
    const notFound = Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });

    sendMock.mockRejectedValueOnce(notFound);
    await expect(service.exists("missing.txt")).resolves.toBe(false);

    sendMock.mockRejectedValueOnce(notFound);
    await expect(service.getSize("missing.txt")).resolves.toBeNull();
  });

  it("retries transient s3 read failures", async () => {
    const service = new StorageService();
    const certificateError = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });

    sendMock.mockRejectedValueOnce(certificateError).mockResolvedValueOnce({ Body: Readable.from("data") });

    const buffer = await service.getBuffer("key.txt");

    expect(buffer.toString()).toBe("data");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does not start an S3 request after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new StorageService().getBuffer("key", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("cancels retry backoff without starting another S3 request", async () => {
    const controller = new AbortController();
    sendMock.mockImplementationOnce(async () => {
      controller.abort();
      throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    });
    await expect(new StorageService().getBuffer("key", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat transient s3 head failures as missing objects", async () => {
    const service = new StorageService();
    const certificateError = Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" });

    sendMock.mockRejectedValue(certificateError);

    await expect(service.exists("key.txt")).rejects.toMatchObject({ code: "CERT_HAS_EXPIRED" });
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it("throws when s3 get missing body", async () => {
    const service = new StorageService();

    sendMock.mockResolvedValueOnce({ Body: null });
    await expect(service.getStream("key.txt")).rejects.toThrow("Missing body");
  });

  it("deletes many keys", async () => {
    const service = new StorageService();

    sendMock.mockResolvedValue({});
    await service.deleteMany(["a", "b"]);

    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
