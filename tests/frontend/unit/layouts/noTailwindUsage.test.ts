import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const layoutsDirectory = resolve(process.cwd(), "frontend/site/layouts");
const tailwindUtilityPattern =
  /["'`](?:\[&|data-\[|inline-flex|flex|grid|block|fixed|absolute|relative|items-|justify-|rounded-|(?:bg|text|border|shadow|overflow|opacity|duration|tracking|leading|translate|animate)-|-?[mp][trblxy]?-|[wh]-(?:\d|\[)|z-)/;

describe("layout styling boundary", () => {
  it("keeps Tailwind utilities out of layout source", () => {
    const sourceDirectories = [layoutsDirectory, join(layoutsDirectory, "components")];
    const violations = sourceDirectories.flatMap((directory) =>
      readdirSync(directory)
        .filter((fileName) => fileName.endsWith(".tsx"))
        .flatMap((fileName) => {
          const source = readFileSync(join(directory, fileName), "utf8");
          const reasons = [];

          if (source.includes("@/lib/utils")) reasons.push("Tailwind-aware class merger import");
          if (tailwindUtilityPattern.test(source)) reasons.push("Tailwind utility token");

          return reasons.map((reason) => `${fileName}: ${reason}`);
        }),
    );

    expect(violations).toEqual([]);
  });
});
