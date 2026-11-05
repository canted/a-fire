import type { PrismaClient } from "@prisma/client";

export async function waitForPageContent(
  prisma: PrismaClient,
  pageId: number,
  text: string,
  attempts = 20,
  waitMs = 500,
) {
  for (let i = 0; i < attempts; i += 1) {
    const doc = await prisma.document.findFirst({
      where: { docable_type: "Note", docable_id: pageId },
    });
    if (doc && JSON.stringify(doc.content).includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw new Error(`Reflected content not found for page ${pageId}`);
}
