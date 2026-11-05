import type { Prisma } from "@prisma/client"

/** Historical fixture access only. The generated client deliberately omits this pointer. */
export async function setLegacySquareCurrentPost(database: Pick<Prisma.TransactionClient, "$executeRaw">, squareId: number, postId: number | null) {
  await database.$executeRaw`UPDATE squares SET current_post_id=${postId} WHERE id=${squareId}`
}

export async function readLegacySquare(database: Pick<Prisma.TransactionClient, "$queryRaw">, squareId: number) {
  const rows = await database.$queryRaw<Array<{ snapshot: { current_entry_id: number | null; [key: string]: unknown } }>>`
    SELECT to_jsonb(s) AS snapshot FROM squares s WHERE id=${squareId}`
  return rows[0]?.snapshot ?? null
}
