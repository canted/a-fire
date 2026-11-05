import { vi } from "vitest";

type RawQuery = <Result = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<Result>;

/** Preserve Prisma's caller-selected raw result type while exposing the fixture query's recorded calls. */
export function mockRawQuery(implementation: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>) {
  const query = vi.fn(implementation);
  return query as typeof query & RawQuery;
}
