import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

const { useRequestOtpMutationMock, navigateMock } = vi.hoisted(() => ({
  useRequestOtpMutationMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("@/hooks/useOtp", () => ({
  useRequestOtpMutation: () => useRequestOtpMutationMock(),
}));

vi.mock("../../../../frontend/site/lib/browserNavigation", () => ({ assignBrowserLocation: navigateMock }));

vi.mock("@/animations/Fire", () => ({
  Fire: () => <div data-testid="fire" />,
}));

import { SitePage } from "../../../../frontend/site/features/site/SitePage";

describe("SitePage", () => {
  beforeEach(() => {
    useRequestOtpMutationMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    navigateMock.mockReset();
    window.localStorage.clear();
  });

  it("submits email and redirects on success", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useRequestOtpMutationMock.mockReturnValue({ mutateAsync, isPending: false });

    render(<SitePage />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test@example.com" } });

    fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);

    expect(mutateAsync).toHaveBeenCalledWith({ email: "test@example.com" });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/auth/verify?email=test%40example.com");
    });
  });

  it("shows error when mutation fails", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("nope"));
    useRequestOtpMutationMock.mockReturnValue({ mutateAsync, isPending: false });

    render(<SitePage />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test@example.com" } });

    fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);

    expect(await screen.findByText("nope")).toBeInTheDocument();
  });

  it("shows an app link for an existing authenticated session", () => {
    window.localStorage.setItem("refreshToken", "refresh-token");
    const mutateAsync = vi.fn();
    useRequestOtpMutationMock.mockReturnValue({ mutateAsync, isPending: false });

    render(<SitePage />);

    expect(screen.queryByPlaceholderText(/you@example.com/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /sign in/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/app");
  });
});
