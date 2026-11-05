import { RealtimeService } from "@server/realtime/realtime.service";
import { vi } from "vitest";

describe("RealtimeService", () => {
  it("reauthorizes recipients and removes denied subscriptions before delivery", async () => {
    const service = new RealtimeService();
    const allowed = { connected: true, rooms: new Set(["entry:1"]), emit: vi.fn(), leave: vi.fn() };
    const denied = { connected: true, rooms: new Set(["entry:1"]), emit: vi.fn(), leave: vi.fn() };
    const authorize = vi.fn().mockImplementation(async (client) => client === allowed);
    service.setServer({ sockets: {
      adapter: { rooms: new Map([["entry:1", new Set(["a", "b"])]]) },
      sockets: new Map([["a", allowed], ["b", denied]]),
    } } as any, authorize);
    await service.emit("EntryChannel", "entry:1", { id: 1, nested: { value: 2 } });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(allowed.emit).toHaveBeenCalledWith("EntryChannel", { id: 1, nested: { value: 2 } });
    expect(denied.emit).not.toHaveBeenCalled();
    expect(denied.leave).toHaveBeenCalledWith("entry:1");
    authorize.mockResolvedValue(false);
    await service.emit("EntryChannel", "entry:1", { id: 2 });
    expect(allowed.emit).toHaveBeenCalledTimes(1);
  });

  it("fails closed on authorization errors and respects unsubscribe during authorization", async () => {
    const service = new RealtimeService();
    const client = { connected: true, rooms: new Set(["entry:1"]), emit: vi.fn(), leave: vi.fn() };
    const authorize = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    service.setServer({ sockets: {
      adapter: { rooms: new Map([["entry:1", new Set(["a"])]]) },
      sockets: new Map([["a", client]]),
    } } as any, authorize);
    await expect(service.emit("EntryChannel", "entry:1", { id: 1 })).resolves.toBeUndefined();
    expect(client.emit).not.toHaveBeenCalled();
    authorize.mockImplementation(async () => { client.rooms.clear(); return true; });
    await service.emit("EntryChannel", "entry:1", { id: 2 });
    expect(client.emit).not.toHaveBeenCalled();
  });

  it("sends visitors only a scoped refresh hint, never publisher content or resource identifiers", async () => {
    const service = new RealtimeService();
    const client = { connected: true, rooms: new Set(["chat:3", "entry:4"]), emit: vi.fn(), leave: vi.fn() };
    service.setServer({ sockets: {
      adapter: { rooms: new Map([...client.rooms].map(room => [room, new Set(["a"])])) },
      sockets: new Map([["a", client]]),
    } } as any, async () => "refresh");
    const privatePayload = { type: "post_reflections", entry_id: 99, reflections: [{ title: "Private Note" }], squares: [{ oldEntry: "hidden" }] };
    await service.emit("ChatChannel", "chat:3", privatePayload);
    await service.emit("EntryChannel", "entry:4", privatePayload);
    expect(client.emit.mock.calls).toEqual([
      ["ChatChannel", { type: "invalidate", room_id: 3 }],
      ["EntryChannel", { type: "invalidate", entry_id: 4 }],
    ]);
    expect(client.leave).not.toHaveBeenCalled();
  });

  it("tracks active users", () => {
    const service = new RealtimeService();

    service.markUserActive(1);
    service.markUserActive(1);
    expect(service.isUserActive(1)).toBe(true);

    service.markUserInactive(1);
    expect(service.isUserActive(1)).toBe(true);

    service.markUserInactive(1);
    expect(service.isUserActive(1)).toBe(false);
  });

  it("builds room names", () => {
    const service = new RealtimeService();
    expect(service.entryRoom(1)).toBe("entry:1");
    expect(service.chatRoom(2)).toBe("chat:2");
    expect(service.noteRoom(3)).toBe("note:3");
    expect(service.notificationRoom(4)).toBe("notification:4");
    expect(service.chatRoom(5)).toBe("chat:5");
  });
});
