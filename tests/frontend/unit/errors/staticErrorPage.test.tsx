import { render, screen } from "@testing-library/react";
import { StaticErrorPage } from "../../../../frontend/site/features/errors/StaticErrorPage";

describe("StaticErrorPage", () => {
  it("renders status and content", () => {
    render(
      <StaticErrorPage
        statusCode={404}
        title="Page not found"
        message="Missing"
        detail="Try again"
      />,
    );

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("omits detail block when not provided", () => {
    render(
      <StaticErrorPage
        statusCode={500}
        title="Error"
        message="Oops"
      />,
    );

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText(/Try again/i)).not.toBeInTheDocument();
  });

  it("links back to the signed-in app root", () => {
    render(<StaticErrorPage statusCode={404} title="Missing" message="Nope" />);

    expect(screen.getByRole("link", { name: "/app" })).toHaveAttribute("href", "/app");
  });
});
