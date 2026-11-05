import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("uses one parameter name for sibling Expo detail routes and their nested routes", () => {
  const conflicts: string[] = [];
  function inspect(directory: string) {
    const children = readdirSync(directory, { withFileTypes: true });
    const dynamicNames = new Set(children.map(child => child.name.match(/^\[([^\]]+)\](?:\.(?:tsx?|jsx?))?$/)?.[1]).filter(Boolean));
    if (dynamicNames.size > 1) conflicts.push(`${directory}: ${[...dynamicNames].join(", ")}`);
    for (const child of children) if (child.isDirectory()) inspect(path.join(directory, child.name));
  }
  inspect(path.resolve("frontend/src/app"));
  expect(conflicts).toEqual([]);
});
