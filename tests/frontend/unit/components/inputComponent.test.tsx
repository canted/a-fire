import { render, screen } from "@testing-library/react";
import { Input } from "../../../../frontend/site/components/Input";
import styles from "../../../../frontend/site/components/Input.module.css";

describe("Input", () => {
  it("renders label, hint, and associates input", () => {
    render(<Input name="email" label="Email" hint="Hint" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("name", "email");
    expect(screen.getByText("Hint")).toBeInTheDocument();
  });

  it("shows error when provided", () => {
    render(<Input name="email" label="Email" error="Required" />);

    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.queryByText("Hint")).not.toBeInTheDocument();
  });

  it("supports bare variant", () => {
    render(<Input name="email" label="Email" variant="bare" />);

    const input = screen.getByLabelText("Email");
    expect(input).toHaveClass(styles.bare);
  });
  it("connects validation and preserves caller descriptions", () => {
    render(<><p id="extra">Extra help</p><Input label="Email" error="Required" aria-describedby="extra" /></>);
    const input = screen.getByRole("textbox", { name: /Email/ });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Extra help Required");
  });

  it("gives repeated named fields independent descriptions", () => {
    render(<><Input name="email" label="First" hint="First help" /><Input name="email" label="Second" hint="Second help" /></>);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(inputs[0]).toHaveAccessibleDescription("First help");
    expect(inputs[1]).toHaveAccessibleDescription("Second help");
  });

});
