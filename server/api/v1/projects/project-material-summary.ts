import { Prisma } from "@prisma/client"

/** One indexed candidate from each publication/fallback history, then one winner. */
export function latestProjectMaterial(projectId: Prisma.Sql) {
  return Prisma.sql`
      SELECT * FROM (
        (SELECT id,user_id,project_intent,published_at AS added_at FROM entries
          WHERE project_id=${projectId} AND status='published' AND creation_origin='project_material'
            AND room_id IS NULL AND published_at IS NOT NULL
          ORDER BY published_at DESC,id DESC LIMIT 1)
        UNION ALL
        (SELECT id,user_id,project_intent,created_at AS added_at FROM entries
          WHERE project_id=${projectId} AND status='published' AND creation_origin='project_material'
            AND room_id IS NULL AND published_at IS NULL
          -- Retain the NULL index key in ordering so PostgreSQL can seek
          -- through the composite index without sorting all fallback rows.
          ORDER BY published_at DESC,created_at DESC,id DESC LIMIT 1)
      ) candidates ORDER BY added_at DESC,id DESC LIMIT 1
`
}
