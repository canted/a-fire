import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const uiDirectory = resolve(process.cwd(), "frontend/site/components");
const tailwindUtilityPattern =
  /["'`](?:\[&|data-\[|inline-flex|flex|grid|block|fixed|absolute|relative|items-|justify-|rounded-|(?:bg|text|border|shadow|overflow|opacity|duration|tracking|leading|translate|animate)-|-?[mp][trblxy]?-|[wh]-(?:\d|\[)|z-)/;

describe("public website primitive styling boundary", () => {
  it("keeps Tailwind utilities and its class merger out of primitive source", () => {
    const files = readdirSync(uiDirectory).filter((fileName) => fileName.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(0);
    const violations = files
      .flatMap((fileName) => {
        const source = readFileSync(join(uiDirectory, fileName), "utf8");
        const reasons = [];

        if (source.includes("@/lib/utils")) reasons.push("Tailwind-aware class merger import");
        if (tailwindUtilityPattern.test(source)) reasons.push("Tailwind utility token");

        return reasons.map((reason) => `${fileName}: ${reason}`);
      });

    expect(violations).toEqual([]);
  });
});
