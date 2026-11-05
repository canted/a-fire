import type { ReactNode } from "react";
import { SWRConfig } from "swr";

export function TestSWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), fetcher: () => Promise.resolve(null) }}>{children}</SWRConfig>;
}
