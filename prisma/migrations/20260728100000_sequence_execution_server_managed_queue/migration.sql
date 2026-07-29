-- Gestión start becomes server-managed: the executive no longer picks a
-- start date/time, so `startAt` (exclusively a manually-picked value) is
-- retired. Real submission-lifecycle instants reported by (or derived
-- from) the server are added instead — these are never manually picked.

-- 1) SequenceExecutionStatus: retire READY/ACCEPTED, add SUBMISSION_UNKNOWN/QUEUED/REJECTED.
--    Remap any existing rows using a retired value before swapping the enum type.
CREATE TYPE "SequenceExecutionStatus_new" AS ENUM ('DRAFT', 'VALIDATING', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED');

ALTER TABLE "sequence_executions" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "sequence_executions"
  ALTER COLUMN "status" TYPE "SequenceExecutionStatus_new"
  USING (
    CASE "status"::text
      WHEN 'READY' THEN 'DRAFT'
      WHEN 'ACCEPTED' THEN 'QUEUED'
      ELSE "status"::text
    END
  )::"SequenceExecutionStatus_new";

ALTER TABLE "sequence_executions" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "SequenceExecutionStatus";
ALTER TYPE "SequenceExecutionStatus_new" RENAME TO "SequenceExecutionStatus";

-- 2) SequenceExecutionServerStatus: retire REQUESTED/ACCEPTED/PROCESSING, add QUEUED.
CREATE TYPE "SequenceExecutionServerStatus_new" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED');

ALTER TABLE "sequence_executions"
  ALTER COLUMN "serverStatus" TYPE "SequenceExecutionServerStatus_new"
  USING (
    CASE "serverStatus"::text
      WHEN 'REQUESTED' THEN 'QUEUED'
      WHEN 'ACCEPTED' THEN 'QUEUED'
      WHEN 'PROCESSING' THEN 'RUNNING'
      ELSE "serverStatus"::text
    END
  )::"SequenceExecutionServerStatus_new";

DROP TYPE "SequenceExecutionServerStatus";
ALTER TYPE "SequenceExecutionServerStatus_new" RENAME TO "SequenceExecutionServerStatus";

-- 3) New real-event columns (all nullable — populated only as each event actually happens).
ALTER TABLE "sequence_executions"
  ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "queuedAt" TIMESTAMP(3),
  ADD COLUMN "estimatedStartAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "receivedProspects" INTEGER,
  ADD COLUMN "acceptedProspects" INTEGER,
  ADD COLUMN "rejectedProspects" INTEGER,
  ADD COLUMN "lastSubmissionIdempotencyKey" TEXT;

-- 4) `name` is now generated only once the start command is actually sent — make it optional before dropping the manual scheduling columns below.
ALTER TABLE "sequence_executions" ALTER COLUMN "name" DROP NOT NULL;

-- 5) Retire the manually-picked start date/time — the server alone decides the effective start now.
ALTER TABLE "sequence_executions" DROP COLUMN "startAt";

-- 6) Retire the never-populated command-id column, superseded by the clearly-named lastSubmissionIdempotencyKey above.
ALTER TABLE "sequence_executions" DROP COLUMN "lastSubmitCommandId";
