import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { Button } from "../../../../frontend/site/components/Button";

describe("Button", () => {
  it("renders label and triggers click", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Submit</Button>);

    const button = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(button);

    expect(button).toBeInTheDocument();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("supports outline emphasis and color tokens", () => {
    render(
      <Button emphasis="outline" color="primary">
        Outline
      </Button>,
    );
    expect(screen.getByRole("button", { name: /outline/i }).className).not.toContain("border-cool-strong");
  });

  it("supports extra-small pill actions", () => {
    render(
      <Button size="xs" shape="pill">
        Compact
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Compact" }).className).toContain("sizeXs");
    expect(screen.getByRole("button", { name: "Compact" }).className).toContain("shapePill");
  });
});
