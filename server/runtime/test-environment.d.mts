export type TestEnvironmentOptions = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  requireDatabase?: boolean;
};
export function assertTestDatabaseIsIsolated(testDatabaseUrl: string | undefined, developmentDatabaseUrl?: string): void;
export function resolveTestEnvironment(options?: TestEnvironmentOptions): NodeJS.ProcessEnv;
export function loadTestEnvironment(options?: TestEnvironmentOptions): NodeJS.ProcessEnv;
