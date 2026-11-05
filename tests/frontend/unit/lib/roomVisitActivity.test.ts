import { afterEach, describe, expect, it, vi } from "vitest";
import { observeRoomVisitActivity } from "../../../../frontend/src/lib/roomVisitActivity.web";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Room visit foreground activity", () => {
  it("does not renew from elapsed time, hidden input or synthetic events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const listen = vi.spyOn(document, "addEventListener");
    const activity = vi.fn();
    const stop = observeRoomVisitActivity(activity);
    expect(activity).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(activity).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("pointerdown"));
    expect(activity).toHaveBeenCalledTimes(1);
    const input = listen.mock.calls.find(([type]) => type === "pointerdown")![1] as EventListener;
    visibility.mockReturnValue("hidden");
    input({ isTrusted: true } as Event);
    expect(activity).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    input({ isTrusted: true } as Event);
    expect(activity).toHaveBeenCalledTimes(2);
    input({ isTrusted: true } as Event);
    expect(activity).toHaveBeenCalledTimes(2);
    stop();
  });

  it("starts on foreground return and removes its observers on departure", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const activity = vi.fn();
    const stop = observeRoomVisitActivity(activity);
    expect(activity).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(activity).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(activity).toHaveBeenCalledTimes(1);
  });
});

it("starts the visible visit while Safari Inspector owns keyboard focus", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const activity = vi.fn();
  const stop = observeRoomVisitActivity(activity);
  expect(activity).toHaveBeenCalledOnce();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(activity).toHaveBeenCalledOnce();
  stop();
});
