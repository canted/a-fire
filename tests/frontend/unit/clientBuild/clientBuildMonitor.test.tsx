import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { clearClientBuildReloadBlockers, setClientBuildReloadBlocker } from "../../../../frontend/site/hooks/clientBuildReloadBlockers";

const { toastMock, useClientBuildStatusMock } = vi.hoisted(() => ({
  toastMock: {
    custom: vi.fn((_render: () => ReactNode) => "toast-id"),
    dismiss: vi.fn(),
  },
  useClientBuildStatusMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/hooks/useClientBuildStatus", () => ({
  useClientBuildStatus: (...args: unknown[]) => useClientBuildStatusMock(...args),
}));

import { ClientBuildMonitor } from "../../../../frontend/site/features/clientBuild/ClientBuildMonitor";

describe("ClientBuildMonitor", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/app");
    window.localStorage.clear();
    clearClientBuildReloadBlockers();
    toastMock.custom.mockClear();
    toastMock.dismiss.mockClear();
    useClientBuildStatusMock.mockReturnValue({
      currentBuildId: "current-build",
      latestBuildId: "next-build",
      updateAvailable: true,
    });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("prompts visible users to reload", async () => {
    const reloadPage = vi.fn();

    render(<ClientBuildMonitor reloadPage={reloadPage} />);

    await waitFor(() => expect(toastMock.custom).toHaveBeenCalled());
    const renderToast = toastMock.custom.mock.calls[0][0] as () => ReactNode;
    render(<>{renderToast()}</>);

    expect(screen.getByText("Update A Fire")).toBeInTheDocument();
    expect(screen.queryByText("A new version is available.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("automatically reloads a hidden clean page once", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const reloadPage = vi.fn();

    render(<ClientBuildMonitor reloadPage={reloadPage} />);

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(toastMock.custom).not.toHaveBeenCalled();
  });

  it("does not automatically reload hidden pages when a draft is dirty", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    setClientBuildReloadBlocker("draft", true);
    const reloadPage = vi.fn();

    render(<ClientBuildMonitor reloadPage={reloadPage} />);

    await waitFor(() => expect(toastMock.custom).toHaveBeenCalled());
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("does not repeat an automatic reload for the same target build", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const reloadPage = vi.fn();
    const { unmount } = render(<ClientBuildMonitor reloadPage={reloadPage} />);

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    unmount();

    render(<ClientBuildMonitor reloadPage={reloadPage} />);

    await waitFor(() => expect(toastMock.custom).toHaveBeenCalled());
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
