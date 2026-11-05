# Recovered historical migrations

These files are historical evidence, **not active Prisma migrations**. They were
recovered byte-for-byte from Git after a read-only development ledger inventory
found completed migration names missing from the current source directory.
They must not be copied back into `migrations/` or executed as an upgrade.

| Migration | Source commit | SHA-256 matching development ledger |
| --- | --- | --- |
| `20260117150000_create_documents` | `d04278ed0f52fad2a803db80809551a70388f3d0` | `2011240b96e4083faa437ba4bc2bf102c3d4443a0d7c9ac2976598a5b059652e` |
| `20260204130000_baseline` | `b2351701ff8a5c93eec7dfaee7460835259947b9` | `d9cdb597ade1dc7478213a1ed78d06c6007000f73233da79cdadc9ac3950dab1` |

The documents migration was removed in `b2351701`; the historical baseline was
removed in `6afdf0322952c8e1fc00974ec913d11cb239a215`. Both recovered checksums
match completed, non-rolled-back rows in the 2026-10-30 `afiredb` ledger snapshot
at `../inventory/retained-migration-ledgers.json`.

The match establishes the exact SQL recorded as applied. It does not prove
that today's database still has the resulting schema, that no manual DDL ran,
or that these migrations were applied to production. Reconcile live schema,
current migration chain, retained data and ledger history on a restored copy
before changing any existing database or consolidating the baseline.

To reproduce recovery, use `git show <source-commit>:server/prisma/migrations/<migration>/migration.sql`
and compare the SHA-256 of its raw bytes. Do not normalize whitespace or line
endings in archived SQL: those bytes are the checksum evidence.
