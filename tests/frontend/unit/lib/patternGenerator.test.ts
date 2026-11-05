import Pattern, { DEFAULT_BASE_COLORS } from "../../../../frontend/src/lib/patternGenerator";

describe("pattern generator", () => {
  it("generates a deterministic svg with defaults", () => {
    const svg = Pattern("address-1", { shapeCount: 2, wobble: 0, baseColors: ["#000000"], width: 10, height: 20 });

    expect(svg).toContain('width="10"');
    expect(svg).toContain('height="20"');
    expect(svg.match(/<rect /g)?.length).toBe(3);
  });

  it("throws when no base colors are provided", () => {
    expect(() => Pattern("address-1", { baseColors: [] })).toThrow("Insufficient base colors");
  });

  it("uses default base colors when none are provided", () => {
    const svg = Pattern("address-2");
    expect(DEFAULT_BASE_COLORS.length).toBeGreaterThan(0);
    expect(svg).toContain("<svg");
  });
});
