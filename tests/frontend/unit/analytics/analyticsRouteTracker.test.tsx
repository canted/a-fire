import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

const { captureEventMock } = vi.hoisted(() => ({
  captureEventMock: vi.fn(),
}));

vi.mock("@/lib/analytics", async () => {
  const actual = await vi.importActual<typeof import("../../../../frontend/site/lib/analytics")>("@/lib/analytics");
  return {
    ...actual,
    captureEvent: captureEventMock,
  };
});

import { AnalyticsRouteTracker } from "../../../../frontend/site/features/analytics/AnalyticsRouteTracker";

function NavigateAfterMount() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/app/entries/42");
  }, [navigate]);
  return <AnalyticsRouteTracker />;
}

describe("AnalyticsRouteTracker", () => {
  it("captures screen views on location changes", async () => {
    captureEventMock.mockClear();

    render(
      <MemoryRouter initialEntries={["/app/board/7"]}>
        <NavigateAfterMount />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(captureEventMock).toHaveBeenCalledWith(
        "screen_viewed",
        expect.objectContaining({ route_name: "board", board_id: "7" }),
      );
      expect(captureEventMock).toHaveBeenCalledWith(
        "screen_viewed",
        expect.objectContaining({ route_name: "post_thread", entry_id: "42" }),
      );
    });
  });
});
