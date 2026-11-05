import { cn } from "../../../../frontend/site/lib/cn";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("one", undefined, false, "two")).toBe("one two");
  });
});
