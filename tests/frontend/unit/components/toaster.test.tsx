import { render } from "@testing-library/react";
import { vi } from "vitest";

const toasterMock = vi.fn((_props: Record<string, unknown>) => null);

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    toasterMock(props);
    return null;
  },
}));

import { Toaster } from "../../../../frontend/site/components/Toaster";

describe("Toaster", () => {
  it("passes through offset and positioning props", () => {
    render(<Toaster />);

    expect(toasterMock).toHaveBeenCalled();
    const props = toasterMock.mock.calls[0][0] as { offset?: { bottom?: string } };
    expect(props.offset?.bottom).toContain("--bottom-nav-height");
  });
});
