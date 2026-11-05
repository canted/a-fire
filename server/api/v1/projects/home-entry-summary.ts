import { Prisma } from "@prisma/client"
import { privateProjectIdsSql, privateProjectWhere } from "./project-access"

/** Compact Home reads return at most four entries, three projects and 374 days. */
export async function homeEntrySummary(database: Pick<Prisma.TransactionClient, "$queryRaw" | "entry">, userId: number, timeZone: string, now = new Date()) {
  const scope = Prisma.sql`user_id=${userId} AND project_id IN (${privateProjectIdsSql(userId)})
    AND status='published' AND room_id IS NULL
    AND creation_origin IN ('project_material','project_feedback')`
  const [recent, projects, contributions] = await Promise.all([
    database.entry.findMany({ where: { user_id: userId, project: privateProjectWhere(userId), status: "published", room_id: null, creation_origin: { in: ["project_material", "project_feedback"] } }, select: { id: true, project_id: true }, orderBy: [{ published_at: "desc" }, { id: "desc" }], take: 4 }),
    database.$queryRaw<Array<{ id: number; project_id: number }>>(Prisma.sql`
      /* home_recent_projects */
      SELECT latest.id, p.project_id FROM (${privateProjectIdsSql(userId)}) AS p(project_id)
      CROSS JOIN LATERAL (
        SELECT id, published_at FROM entries WHERE ${scope} AND project_id=p.project_id
        ORDER BY published_at DESC, id DESC LIMIT 1
      ) latest ORDER BY latest.published_at DESC, latest.id DESC LIMIT 3`),
    database.$queryRaw<Array<{ date: string; count: number }>>(Prisma.sql`
      SELECT to_char(timezone(${timeZone}, COALESCE(published_at,created_at) AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
        count(*)::integer AS count
      FROM entries WHERE ${scope} AND COALESCE(published_at,created_at)>=(${new Date(now.getTime() - 372 * 86400000)}::timestamptz AT TIME ZONE 'UTC')
        AND COALESCE(published_at,created_at)<=(${now}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1 ORDER BY 1`),
  ])
  return { recent, projects, contributions }
}
