import { render, screen } from "@testing-library/react";
import { NotFound } from "../../../../frontend/site/layouts/components/NotFound";

describe("NotFound", () => {
  it("renders the not found message", () => {
    render(<NotFound />);

    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
    expect(screen.getByText(/try another link/i)).toBeInTheDocument();
  });
});
