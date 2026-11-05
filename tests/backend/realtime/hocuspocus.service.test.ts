import { withTestDependencies } from "@tests/backend/helpers/service";
import { HocuspocusService } from "@server/realtime/hocuspocus.service";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { vi } from "vitest";
import * as Y from "yjs";

let capturedOptions: any;

vi.mock("@hocuspocus/server", () => {
  class HocuspocusMock {
    hooks = vi.fn();
    handleConnection = vi.fn();
    constructor(options: any) {
      capturedOptions = options;
    }
  }
  return { Hocuspocus: HocuspocusMock };
});

vi.mock("@hocuspocus/transformer", async importOriginal => {
  const actual = await importOriginal<typeof import("@hocuspocus/transformer")>();
  return { ...actual, TiptapTransformer: {
    ...actual.TiptapTransformer,
    toYdoc: vi.fn(actual.TiptapTransformer.toYdoc.bind(actual.TiptapTransformer)),
    fromYdoc: vi.fn(actual.TiptapTransformer.fromYdoc.bind(actual.TiptapTransformer)),
  } };
});

const makePrisma = () => {
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ room_id: null }]),
  page: { findUnique: vi.fn() },
  roomMembership: { findFirst: vi.fn() },
  document: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  return prisma;
};

const makeAuth = () => ({ verifyAccessToken: vi.fn() });

describe("HocuspocusService", () => {
  const makeService = () => {
    return withTestDependencies(new HocuspocusService(), {
      prisma: makePrisma(),
      authService: makeAuth(),
    });
  };

  it("parses pageId from document name", () => {
    const service = makeService();
    expect((service as any).pageIdFromDocumentName("page:12")).toBe(12);
    expect((service as any).pageIdFromDocumentName("bad")).toBe(null);
  });

  it("ensures page access and membership", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: 2 });
    service.prisma.roomMembership.findFirst.mockResolvedValue(null);

    await expect((service as any).ensurePageAccess(1, 1)).rejects.toThrow("Forbidden");

    service.prisma.roomMembership.findFirst.mockResolvedValue({ id: 5 });
    await expect((service as any).ensurePageAccess(1, 1)).resolves.toBeUndefined();
  });

  it("rejects invalid document name", async () => {
    const service = makeService();
    await expect((service as any).persistDocument("bad", new Y.Doc(), { userId: 1 })).rejects.toThrow("Invalid document name");
  });

  it("throws when page missing", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue(null);
    await expect((service as any).ensurePageAccess(1, 1)).rejects.toThrow("Not Found");
  });

  it("persists documents by updating existing", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: null });
    service.prisma.document.findFirst.mockResolvedValue({ id: 9 });

    await (service as any).persistDocument("page:1", new Y.Doc(), { userId: 1 });

    expect(service.prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ydoc_state: expect.any(Buffer),
        }),
      }),
    );
  });

  it("rejects browser-local media URLs during collaborative persistence", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: null });
    service.prisma.document.findFirst.mockResolvedValue({ id: 9 });
    vi.mocked(TiptapTransformer.fromYdoc).mockReturnValueOnce({
      type: "doc",
      content: [{ type: "image", attrs: { src: "blob:https://afire.app/local-page-image" } }],
    });

    await expect((service as any).persistDocument("page:1", new Y.Doc(), { userId: 1 })).rejects.toThrow(
      "Media must be uploaded before saving content",
    );
    expect(service.prisma.document.update).not.toHaveBeenCalled();
    expect(service.prisma.document.create).not.toHaveBeenCalled();
  });

  it("persists documents by creating new", async () => {
    const service = makeService();
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: null });
    service.prisma.document.findFirst.mockResolvedValue(null);

    await (service as any).persistDocument("page:1", new Y.Doc(), { userId: 1 });

    expect(service.prisma.document.create).toHaveBeenCalled();
  });

  it("loads persisted ydoc state without rebuilding from JSON", async () => {
    const service = makeService();
    const httpServer = { on: vi.fn() } as any;
    const stored = new Y.Doc();
    stored.getMap("meta").set("seed", "present");
    const state = Y.encodeStateAsUpdate(stored);
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: null });
    service.prisma.document.findFirst.mockResolvedValue({
      id: 9,
      content: { type: "doc", content: [{ type: "paragraph", content: [] }] },
      ydoc_state: Buffer.from(state),
    });
    vi.mocked(TiptapTransformer.toYdoc).mockClear();

    service.attach(httpServer);
    const loaded = await capturedOptions.onLoadDocument({ documentName: "page:1", context: { userId: 42 } });

    expect(loaded).toBeInstanceOf(Y.Doc);
    expect(TiptapTransformer.toYdoc).not.toHaveBeenCalled();
  });

  it("backfills ydoc state when loading legacy JSON documents", async () => {
    const service = makeService();
    const httpServer = { on: vi.fn() } as any;
    const loadedDoc = new Y.Doc();
    loadedDoc.getMap("meta").set("seed", "legacy");
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: null });
    service.prisma.document.findFirst.mockResolvedValue({
      id: 9,
      content: { type: "doc", content: [{ type: "paragraph", content: [] }] },
      ydoc_state: null,
    });
    vi.mocked(TiptapTransformer.toYdoc).mockReturnValueOnce(loadedDoc as any);

    service.attach(httpServer);
    await capturedOptions.onLoadDocument({ documentName: "page:1", context: { userId: 42 } });

    expect(service.prisma.document.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { ydoc_state: expect.any(Buffer) },
    });
  });

  it("hashes content consistently", () => {
    const service = makeService();
    const first = (service as any).hashContent({ a: 1 });
    const second = (service as any).hashContent({ a: 1 });
    expect(first).toBe(second);
  });

  it("parses url safely", () => {
    const service = makeService();
    const request = { url: "/hocuspocus", headers: { host: "example.com" } } as any;
    const parsed = (service as any).parseUrl(request);
    expect(parsed?.pathname).toBe("/hocuspocus");

    const bad = (service as any).parseUrl({ url: "http://[bad", headers: { host: "x" } } as any);
    expect(bad).toBeNull();
  });

  it("authenticates and loads documents via hooks", async () => {
    const service = makeService();
    const httpServer = { on: vi.fn() } as any;
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    service.authService.verifyAccessToken.mockReturnValue({ userId: 42 });
    service.prisma.page.findUnique.mockResolvedValue({ id: 1, room_id: null });
    service.prisma.document.findFirst.mockResolvedValue({ id: 9, content: { type: "doc", content: [] }, ydoc_state: null });

    service.attach(httpServer);

    await expect(capturedOptions.onAuthenticate({ token: "tok", documentName: "page:1" })).resolves.toEqual({ userId: 42 });
    await expect(capturedOptions.onAuthenticate({})).rejects.toThrow("Unauthorized");
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(JSON.stringify({ event: "hocuspocus_auth_failed", reason: "missing_token" }));

    await expect(
      capturedOptions.onLoadDocument({ documentName: "page:1", context: { userId: 42 } }),
    ).resolves.toBeInstanceOf(Y.Doc);
    await expect(
      capturedOptions.onLoadDocument({ documentName: "bad", context: { userId: 42 } }),
    ).rejects.toThrow("Invalid document name");
    consoleWarnSpy.mockRestore();
  });

  it("does not reattach when server exists", () => {
    const service = makeService();
    const httpServer = { on: vi.fn() } as any;

    service.attach(httpServer);
    service.attach(httpServer);

    expect(httpServer.on).toHaveBeenCalledTimes(3);
  });
});
