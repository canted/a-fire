import { prisma } from "./database";
import { setTimeout as delay } from "node:timers/promises";


const DEFAULT_ATTEMPTS = 20;
const DEFAULT_WAIT_MS = 500;

export async function latestOtp(email: string, attempts = DEFAULT_ATTEMPTS, waitMs = DEFAULT_WAIT_MS): Promise<string> {
  const normalized = email.toLowerCase();

  for (let i = 0; i < attempts; i += 1) {
    const record = await prisma.oneTimeToken.findFirst({
      where: { email: normalized, purpose: { in: ["login", "invite"] } },
      orderBy: { created_at: "desc" },
    });

    if (record?.token) return record.token;
    await delay(waitMs);
  }

  throw new Error(`OTP not found for ${normalized}`);
}

export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
}
