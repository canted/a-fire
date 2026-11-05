import { setTimeout as delay } from "node:timers/promises";
import { setTimeout, clearTimeout } from "node:timers";
import { withNoteDocumentTransaction } from "../api/v1/pages/note-document-transaction";
import { noteSyncUpdate } from "./note-sync-update";
import { NoteChangeListener } from "./note-change-listener";
import { guardNoteDelivery } from "./note-delivery-guard";
import type { Prisma } from "@prisma/client";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import crypto from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Hocuspocus, type beforeHandleMessagePayload } from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { Node } from "@tiptap/core";
import { fileNodeSchema } from "../../frontend/src/lib/contentNodeSchemas";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import * as Y from "yjs";
import type { Doc } from "yjs";
import { WebSocketServer } from "ws";
import { AuthService } from "../api/v1/auth/auth.service";
import { findUnsupportedMediaSrcs, normalizePrivateUploadUrls } from "../api/v1/uploads/upload-urls";
import { insertBlocksAfterAudioNode, isTargetAudioNode, type AudioInsertionTarget } from "../api/v1/pages/page-content-blocks";
import { PrismaService } from "../prisma/prisma.service";
import { AudioNode } from "./audio";
import { AudioTimestampNode } from "./audio-timestamp";
import { ContentSourceNode } from "./content-source";
import { NoteLinkNode } from "./page-link";
import { VideoNode } from "./video";

const DEFAULT_TIPTAP_DOC: TiptapDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }],
};

const SAVE_DELAY_MS = 20_000;
export const PAGE_TIPTAP_EXTENSIONS = [
  TextStyleKit,
  StarterKit.configure({ link: false }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Highlight.configure({ multicolor: true }),
  Image,
  Link.configure({ openOnClick: false }),
  AudioNode,
  VideoNode,
  Node.create(fileNodeSchema("editor")),
  AudioTimestampNode,
  ContentSourceNode,
  NoteLinkNode,
];

type CollaborationContext = {
  userId: number;
};

type AuthenticatePayload = {
  request?: IncomingMessage;
  documentName: string;
  token?: string | null;
};

type DocumentPayload = {
  documentName: string;
  document: Doc;
  context: CollaborationContext;
};

type LoadPayload = {
  documentName: string;
  context: CollaborationContext;
};

type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

type TiptapDoc = {
  type: "doc";
  content?: TiptapNode[];
};

@Injectable()
export class HocuspocusService {
  @Inject(AuthService)
  private readonly authService!: AuthService;

  @Inject(PrismaService)
  private readonly prisma!: PrismaService;

  private server: Hocuspocus | null = null;
  private wsServer: WebSocketServer | null = null;
  private changeListener: NoteChangeListener | null = null;
  private readonly pendingNoteChanges = new Set<number>();
  private refreshingNotes = false;
  private refreshRetry: ReturnType<typeof setTimeout> | undefined;

  private readonly activeWrites = new Set<Promise<unknown>>();
  private draining = false;
  private drainPromise: Promise<void> | null = null;

  async onModuleDestroy(): Promise<void> { await this.drain(); }

  drain(): Promise<void> {
    this.draining = true;
    this.drainPromise ??= this.finishDrain();
    return this.drainPromise;
  }

  private async finishDrain(): Promise<void> {
    await this.stopNoteChanges();
    this.server?.closeConnections();
    for (const client of this.wsServer?.clients ?? []) client.close(1001, "Server restarting");
    while (this.server && (this.server.documents.size || this.server.loadingDocuments.size || this.server.unloadingDocuments.size || this.activeWrites.size)) {
      this.server.closeConnections();
      await delay(20);
    }
    if (this.wsServer) await new Promise<void>(resolve => this.wsServer!.close(() => resolve()));
  }

  private async stopNoteChanges(): Promise<void> {
    clearTimeout(this.refreshRetry);
    this.pendingNoteChanges.clear();
    const listener = this.changeListener;
    this.changeListener = null;
    await listener?.stop();
  }

  private queueNoteRefresh(pageId: number): void {
    if (!this.server || !this.changeListener) return;
    const names = [`note:${pageId}`, `page:${pageId}`];
    if (!names.some(name => this.server!.documents.has(name) || this.server!.loadingDocuments.has(name))) return;
    this.pendingNoteChanges.add(pageId);
    void this.refreshCommittedNotes();
  }

  private async refreshCommittedNotes(): Promise<void> {
    if (this.refreshingNotes || !this.changeListener || !this.server) return;
    this.refreshingNotes = true;
    try {
      while (this.pendingNoteChanges.size && this.changeListener) {
        const ids: number[] = [];
        for (const id of this.pendingNoteChanges) { ids.push(id); if (ids.length === 64) break; }
        ids.forEach(id => this.pendingNoteChanges.delete(id));
        try {
          const records = await this.prisma.document.findMany({
            where: { docable_type: "Note", docable_id: { in: ids } },
            select: { docable_id: true, ydoc_state: true },
          });
          if (!this.changeListener) return;
          for (const record of records) {
            const update = asYdocUpdate(record.ydoc_state);
            if (!update) continue;
            try {
              // Validate without touching a live document. One corrupt stored record
              // must not prevent unrelated Notes in the same batch from refreshing.
              const validated = createYdocFromStoredState(update);
              if (!validated) throw new Error("Invalid stored Note state");
              validated.destroy();
              for (const name of [`note:${record.docable_id}`, `page:${record.docable_id}`]) {
                const document = this.server.documents.get(name)
                  ?? await this.server.loadingDocuments.get(name)?.catch(() => undefined);
                if (document && this.changeListener) Y.applyUpdate(document, update);
              }
            } catch { console.warn(`[Notes] Invalid committed state for Note ${record.docable_id}`); }
          }
        } catch {
          if (!this.changeListener) return;
          ids.forEach(id => this.pendingNoteChanges.add(id));
          console.warn("[Notes] Committed-state refresh failed; retrying");
          clearTimeout(this.refreshRetry);
          this.refreshRetry = setTimeout(() => { void this.refreshCommittedNotes(); }, 1000);
          return;
        }
      }
    } finally { this.refreshingNotes = false; }
  }

  private readonly socketIdentities = new WeakMap<IncomingMessage, Map<string, number>>();
  attach(httpServer: HttpServer) {
    if (this.server) return;

    try {
      this.server = new Hocuspocus({
        name: "hocuspocus",
        debounce: 2_000,
        maxDebounce: SAVE_DELAY_MS,
        onAuthenticate: async (data: AuthenticatePayload): Promise<CollaborationContext> => {
          if (this.draining) throw new Error("Server restarting");
          const token = typeof data.token === "string" ? data.token : null;
          if (!token) {
            console.warn(JSON.stringify({ event: "hocuspocus_auth_failed", reason: "missing_token" }));
            throw new Error("Unauthorized");
          }
          const { userId } = this.authService.verifyAccessToken(token);
          const pageId = this.pageIdFromDocumentName(data.documentName);
          if (!pageId) throw new Error("Invalid document name");
          await this.ensurePageAccess(pageId, userId);
          if (data.request) this.socketIdentities.get(data.request)?.set(data.documentName, userId);
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ event: "hocuspocus_auth", user_id: userId }));
          return { userId };
        },
        // Hocuspocus awaits this hook before applying sync/awareness messages.
        // A connection's original authentication does not preserve Room access.
        beforeHandleMessage: async (data: beforeHandleMessagePayload) => {
          if (this.draining) throw new Error("Server restarting");
          const pageId = this.pageIdFromDocumentName(data.documentName);
          if (!pageId) throw new Error("Invalid document name");
          await this.ensurePageAccess(pageId, data.context.userId);
          if (this.draining) throw new Error("Server restarting");
          const update = noteSyncUpdate(data.update, data.documentName);
          if (update && !data.connection.readOnly) {
            // The library awaits this hook before applying/broadcasting or acknowledging
            // the update. Persist against current stored history first, not a live snapshot.
            const committed = await this.persistIncomingUpdate(pageId, data.context.userId, update);
            Y.applyUpdate(data.document, committed);
          }
        },
        onLoadDocument: async (data: LoadPayload) => {
          const pageId = this.pageIdFromDocumentName(data.documentName);
          if (!pageId) {
            throw new Error("Invalid document name");
          }
          return withNoteDocumentTransaction(this.prisma, pageId, async transaction => {
            await this.ensurePageAccess(pageId, data.context.userId, transaction);
            const document = await transaction.document.findFirst({
              where: { docable_type: "Note", docable_id: pageId },
            });
            const content = normalizeUploadUrls(document?.content ?? DEFAULT_TIPTAP_DOC);
            let ydoc = createYdocFromStoredState(document?.ydoc_state);
            if (!ydoc && document?.ydoc_state) {
              console.warn(
                this.safeStringify({
                  event: "hocuspocus_load_ydoc_state_failed",
                  page_id: pageId,
                  user_id: data.context.userId,
                  document_id: document.id,
                }),
              );
            }
            const source = ydoc ? "ydoc_state" : "content";
            ydoc ??= createYdocFromTiptapContent(content);
            if (document && source === "content" && ydoc instanceof Y.Doc) {
              await transaction.document.update({
                where: { id: document.id },
                data: { ydoc_state: encodeYdocState(ydoc) },
              });
            }
            if (!document && ydoc instanceof Y.Doc) {
              await transaction.document.create({ data: {
                docable_type: "Note", docable_id: pageId,
                content: content as Prisma.InputJsonValue, ydoc_state: encodeYdocState(ydoc),
                version: 1, created_at: new Date(), updated_at: new Date(),
              } });
            }
            // eslint-disable-next-line no-console
            console.log(
              this.safeStringify({
                event: "hocuspocus_load",
                page_id: pageId,
                user_id: data.context.userId,
                document_id: document?.id ?? null,
                source,
                content_hash: this.hashContent(content),
                content_size: this.safeStringify(content ?? {}).length,
              }),
            );
            return ydoc;
          });
        },
        onStoreDocument: async (data: DocumentPayload) => {
          await this.persistDocument(data.documentName, data.document, data.context);
        },
      });

      this.wsServer = new WebSocketServer({ noServer: true });

      httpServer.on("listening", () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString || this.changeListener) return;
        this.changeListener = new NoteChangeListener(connectionString, id => this.queueNoteRefresh(id), () => {
          const names = new Set([...(this.server?.documents.keys() ?? []), ...(this.server?.loadingDocuments.keys() ?? [])]);
          for (const name of names) {
            const id = this.pageIdFromDocumentName(name);
            if (id) this.queueNoteRefresh(id);
          }
        }, () => { console.warn("[Notes] Change listener disconnected; reconnecting"); });
        void this.changeListener.start();
      });
      httpServer.on("close", () => { void this.onModuleDestroy(); });

      httpServer.on("upgrade", async (request, socket, head) => {
        const url = this.parseUrl(request);
        if (!url || url.pathname !== "/hocuspocus") return;
        if (this.draining) { socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); return; }

        try {
          await this.server?.hooks("onUpgrade", {
            request,
            socket,
            head,
            instance: this.server,
          });
        } catch (error) {
          if (error) {
            console.warn("[Hocuspocus] upgrade rejected", String(error));
          }
          return;
        }

        this.wsServer?.handleUpgrade(request, socket, head, (ws) => {
          this.wsServer?.emit("connection", ws, request);
        });
      });

      this.wsServer.on("connection", (ws, request) => {
        const identities = new Map<string, number>();
        this.socketIdentities.set(request, identities);
        guardNoteDelivery(ws, async documentName => {
          const userId = identities.get(documentName);
          const pageId = this.pageIdFromDocumentName(documentName);
          if (!userId || !pageId) throw new Error("Unauthorized");
          await this.ensurePageAccess(pageId, userId);
        });
        this.server?.handleConnection(ws, request);
      });
    } catch (error) {
      console.warn("[Hocuspocus] initialization failed", String(error));
      this.server = null;
      this.wsServer = null;
    }
  }

  async prependPageContentBlocks(pageId: number, userId: number, blocks: TiptapNode[]): Promise<TiptapDoc | null> {
    return this.insertStoredContentBlocks(pageId, userId, blocks);
  }

  async insertPageContentBlocksAfterAudio(
    pageId: number,
    userId: number,
    blocks: TiptapNode[],
    target: AudioInsertionTarget,
  ): Promise<TiptapDoc | null> {
    return this.insertStoredContentBlocks(pageId, userId, blocks, target);
  }

  private async insertStoredContentBlocks(pageId: number, userId: number, blocks: TiptapNode[], target?: AudioInsertionTarget): Promise<TiptapDoc | null> {
    if (!this.server) return null;
    assertPersistableContent(buildTiptapDoc(blocks));
    const saved = await this.mutatePersistedDocument(pageId, userId, document => {
      insertYdocContentBlocks(document, blocks, target);
    });
    // Existing and already-loading aliases receive only committed state. Loads
    // starting after this lookup read the same persisted history.
    for (const name of [`note:${pageId}`, `page:${pageId}`]) {
      const document = this.server.documents.get(name)
        ?? await this.server.loadingDocuments.get(name)?.catch(() => undefined);
      if (document) Y.applyUpdate(document, saved.state);
    }
    return saved.content;
  }

  private async persistIncomingUpdate(pageId: number, userId: number, update: Uint8Array): Promise<Uint8Array> {
    return (await this.mutatePersistedDocument(pageId, userId, document => { Y.applyUpdate(document, update); })).state;
  }

  private mutatePersistedDocument(pageId: number, userId: number, mutate: (document: Doc) => void): Promise<{ state: Uint8Array; content: TiptapDoc }> {
    const operation = withNoteDocumentTransaction(this.prisma, pageId, async transaction => {
      await this.ensurePageAccess(pageId, userId, transaction);
      const existing = await transaction.document.findFirst({ where: { docable_type: "Note", docable_id: pageId } });
      const document = createYdocFromStoredState(existing?.ydoc_state)
        ?? createYdocFromTiptapContent(existing?.content ?? { type: "doc", content: [] });
      try {
        const before = encodeYdocState(document);
        mutate(document);
        const state = encodeYdocState(document);
        const content = normalizeTiptapDoc(normalizeUploadUrls(TiptapTransformer.fromYdoc(document, "default")));
        assertPersistableContent(content);
        // Replayed packets and initial synchronization must not create false revisions.
        if (!existing || !state.equals(before) || !existing.ydoc_state) {
          if (existing) {
            await transaction.document.update({ where: { id: existing.id }, data: {
              content: content as Prisma.InputJsonValue, ydoc_state: state,
              version: { increment: 1 }, updated_at: new Date(),
            } });
          } else {
            await transaction.document.create({ data: {
              docable_type: "Note", docable_id: pageId, content: content as Prisma.InputJsonValue,
              ydoc_state: state, version: 1, created_at: new Date(), updated_at: new Date(),
            } });
          }
        }
        return { state, content };
      } finally { document.destroy(); }
    });
    this.activeWrites.add(operation);
    void operation.then(() => this.activeWrites.delete(operation), () => this.activeWrites.delete(operation));
    return operation;
  }

  private async persistDocument(documentName: string, document: Doc, context: CollaborationContext) {
    const pageId = this.pageIdFromDocumentName(documentName);
    if (!pageId) {
      throw new Error("Invalid document name");
    }
    const committed = await this.persistIncomingUpdate(pageId, context.userId, encodeYdocState(document));
    Y.applyUpdate(document, committed);
  }

  private pageIdFromDocumentName(name: string): number | null {
    const match = /^(?:note|page):(\d+)$/.exec(name);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  private async ensurePageAccess(pageId: number, userId: number, database: Prisma.TransactionClient = this.prisma): Promise<void> {
    const page = await database.page.findUnique({ where: { id: pageId } });
    if (!page || page.deleted_at) throw new Error("Not Found");
    if (!page.room_id) return;

    const membership = await database.roomMembership.findFirst({
      where: { room_id: page.room_id, user_id: userId, disabled: false, room: { deleted_at: null } },
      select: { id: true },
    });
    if (!membership) {
      throw new Error("Forbidden");
    }
  }

  private parseUrl(request: IncomingMessage): URL | null {
    const host = request.headers.host;
    if (!request.url || !host) return null;
    try {
      return new URL(request.url, `http://${host}`);
    } catch {
      return null;
    }
  }

  private hashContent(content: unknown) {
    const serialized = this.safeStringify(content ?? {});
    return crypto.createHash("sha256").update(serialized).digest("hex");
  }

  private safeStringify(value: unknown) {
    return JSON.stringify(value, (_key, val) => (typeof val === "number" ? Number(val) : val));
  }
}

function normalizeTiptapDoc(content: unknown): TiptapDoc {
  if (content && typeof content === "object" && (content as { type?: unknown }).type === "doc") {
    const nodes = Array.isArray((content as { content?: unknown }).content)
      ? ((content as { content: TiptapNode[] }).content ?? [])
      : [];
    return { type: "doc", content: nodes };
  }

  return DEFAULT_TIPTAP_DOC;
}

function buildTiptapDoc(nodes: TiptapNode[]): TiptapDoc {
  return {
    type: "doc",
    content: nodes.length ? nodes : DEFAULT_TIPTAP_DOC.content,
  };
}

export function createYdocFromTiptapContent(content: unknown): Doc {
  return TiptapTransformer.toYdoc(content ?? DEFAULT_TIPTAP_DOC, "default", PAGE_TIPTAP_EXTENSIONS);
}

export function encodeTiptapContentAsYdocState(content: unknown) {
  return encodeYdocState(createYdocFromTiptapContent(normalizeUploadUrls(content ?? DEFAULT_TIPTAP_DOC)));
}

export function encodeYdocState(document: Doc) {
  return Buffer.from(Y.encodeStateAsUpdate(document));
}

export function createYdocFromStoredState(value: unknown): Doc | null {
  const update = asYdocUpdate(value);
  if (!update) return null;

  try {
    const document = new Y.Doc();
    Y.applyUpdate(document, update);
    return document;
  } catch {
    return null;
  }
}

function asYdocUpdate(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) {
    return value.byteLength > 0 ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
  }
  if (value instanceof Uint8Array) {
    return value.byteLength > 0 ? value : null;
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0 ? new Uint8Array(value) : null;
  }
  if (Array.isArray(value) && value.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return value.length > 0 ? Uint8Array.from(value) : null;
  }
  return null;
}

/** Replace visible content within the persisted CRDT history so old snapshots cannot resurrect it. */
export function replaceYdocContent(document: Doc, content: TiptapDoc): TiptapDoc {
  const replacement = createYdocFromTiptapContent(content);
  try {
    const nodes = replacement.getXmlFragment("default").toArray().map(node => {
      if (!(node instanceof Y.XmlElement) && !(node instanceof Y.XmlText)) throw new Error("Unsupported Note node");
      return node.clone();
    });
    const fragment = document.getXmlFragment("default");
    document.transact(() => {
      fragment.delete(0, fragment.length);
      fragment.insert(0, nodes);
    });
    return normalizeTiptapDoc(TiptapTransformer.fromYdoc(document, "default"));
  } finally { replacement.destroy(); }
}

/** Preserve existing CRDT node identities when inserting server-generated blocks. */
export function insertYdocContentBlocks(document: Doc, blocks: TiptapNode[], target?: AudioInsertionTarget): TiptapDoc {
  const current = normalizeTiptapDoc(TiptapTransformer.fromYdoc(document, "default"));
  if (!blocks.length) return current;
  if (target) {
    const insertion = insertBlocksAfterAudioNode(current.content ?? [], blocks, target);
    if (!insertion.inserted) throw new Error("Audio node not found");
    if (insertion.nodes === current.content) return current;
  }
  const additions = createYdocFromTiptapContent({ type: "doc", content: blocks });
  try {
    const nodes = additions.getXmlFragment("default").toArray().map(node => {
      if (!(node instanceof Y.XmlElement) && !(node instanceof Y.XmlText)) throw new Error("Unsupported Note node");
      return node.clone();
    });
    const fragment = document.getXmlFragment("default");
    const locate = (parent: Y.XmlFragment | Y.XmlElement): { parent: Y.XmlFragment | Y.XmlElement; index: number } | null => {
      const children = parent.toArray();
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (!(child instanceof Y.XmlElement)) continue;
        if (target && isTargetAudioNode({ type: child.nodeName, attrs: child.getAttributes() }, target)) return { parent, index: index + 1 };
        const nested = locate(child);
        if (nested) return nested;
      }
      return null;
    };
    const position = target ? locate(fragment) : { parent: fragment, index: 0 };
    if (!position) throw new Error("Audio node not found");
    document.transact(() => position.parent.insert(position.index, nodes));
    return normalizeTiptapDoc(TiptapTransformer.fromYdoc(document, "default"));
  } finally {
    additions.destroy();
  }
}

function normalizeUploadUrls(content: unknown): unknown {
  return normalizePrivateUploadUrls(content).value;
}

function assertPersistableContent(content: unknown): void {
  const unsupportedMediaSrcs = findUnsupportedMediaSrcs(content);
  if (unsupportedMediaSrcs.length > 0) {
    throw new Error("Media must be uploaded before saving content");
  }
}
