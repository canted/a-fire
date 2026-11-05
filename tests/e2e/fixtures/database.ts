import { PrismaClient } from "@prisma/client";
import { loadTestEnvironment } from "../../../server/runtime/test-environment.mjs";

// Validate even when fixtures are imported outside the Playwright runner.
const environment = loadTestEnvironment({ requireDatabase: true });
export const prisma = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } });
