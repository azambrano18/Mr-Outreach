-- Fase 2 — additive-only migration. Adds:
-- 1) SequencePublishStatus enum + 5 columns to "sequences" to give the
--    previously Postgres-unpersisted publish lifecycle (publishStatus/
--    sequenceVersion/effectiveStartAt/lastPublishedAt/lastPublishCommandId
--    — see PrismaSequenceRepository's old hardcoded-null mapping) a real,
--    restart-durable home.
-- 2) 3 nullable columns to "integration_commands" (payloadHash,
--    resultSnapshot, httpStatusCode) so this existing table — which
--    already has UNIQUE(organizationId, idempotencyKey) — can serve as
--    the persistent idempotency registry for Fase 2, with no new table.
-- Does not touch any other table, does not touch public.maestro_clientes
-- (not modeled by Prisma at all), does not drop or rename any column.
--
-- Pre-migration verification (mr-outreach-test, read-only, 2026-07-23):
-- 2 sequences total, both DRAFT, 0 SEQUENCE_PUBLISH_REQUESTED commands,
-- 0 non-PENDING sequence_contacts, 0 scheduled_emails — no evidence of
-- prior publication under any mechanism. publishStatus stays NULL for
-- existing rows: "never published, by any mechanism, ever."

-- CreateEnum
CREATE TYPE "SequencePublishStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'PROCESSING', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "integration_commands" ADD COLUMN     "httpStatusCode" INTEGER,
ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "resultSnapshot" JSONB;

-- AlterTable
ALTER TABLE "sequences" ADD COLUMN     "effectiveStartAt" TIMESTAMP(3),
ADD COLUMN     "lastPublishCommandId" TEXT,
ADD COLUMN     "lastPublishedAt" TIMESTAMP(3),
ADD COLUMN     "publishStatus" "SequencePublishStatus",
ADD COLUMN     "sequenceVersion" INTEGER NOT NULL DEFAULT 0;
