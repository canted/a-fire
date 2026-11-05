import { getMetaContent } from "../../src/lib/browserMeta";
type EnvConfig = {
  apiBaseUrl: string;
  graphqlEndpoint: string;
  enableMocks: boolean;
  vapidPublicKey?: string;
};

function booleanFromEnv(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export const env: EnvConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
  graphqlEndpoint: import.meta.env.VITE_GRAPHQL_ENDPOINT || "/api/graphql",
  enableMocks: booleanFromEnv(import.meta.env.VITE_ENABLE_MOCKS),
  vapidPublicKey: getMetaContent("vapid-public-key"),
};
