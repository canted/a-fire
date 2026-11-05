import { render, screen } from "@testing-library/react";
import { Input } from "../../../../frontend/site/components/Input";

describe("Input", () => {
  it("renders label and hint", () => {
    render(<Input label="Title" hint="Describe your update" name="title" />);

    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByText("Describe your update")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<Input label="Title" error="Required" name="title" />);

    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
