-- Simplifies the Gestión-start contract down to serverTemplateId + the
-- normalized prospect list. The server now resolves the Plantilla,
-- version, and mailbox on its own; queue/dispatch/technical-owner/
-- initial-step concepts are never sent by Mr Outreach and are dropped
-- here as residual local fields.

-- 1) SequenceExecutionStatus: rename QUEUED -> ACCEPTED. A successful
--    submission is now "ACCEPTED"; any later server-reported QUEUED
--    status is surfaced only via serverStatus, never as the local status.
CREATE TYPE "SequenceExecutionStatus_new" AS ENUM ('DRAFT', 'VALIDATING', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED');

ALTER TABLE "sequence_executions" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "sequence_executions"
  ALTER COLUMN "status" TYPE "SequenceExecutionStatus_new"
  USING (
    CASE "status"::text
      WHEN 'QUEUED' THEN 'ACCEPTED'
      ELSE "status"::text
    END
  )::"SequenceExecutionStatus_new";

ALTER TABLE "sequence_executions" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "SequenceExecutionStatus";
ALTER TYPE "SequenceExecutionStatus_new" RENAME TO "SequenceExecutionStatus";

-- 2) §2/§11 — server-administered per-prospect lifecycle.
CREATE TYPE "ProspectExecutionState" AS ENUM ('STEP_01_PENDING', 'STEP_01_PROCESSING', 'STEP_01_SENT', 'STEP_02_PENDING', 'STEP_02_PROCESSING', 'STEP_02_SENT', 'STEP_03_PENDING', 'STEP_03_PROCESSING', 'STEP_03_SENT', 'COMPLETED', 'FAILED');

ALTER TABLE "prospect_import_rows" ADD COLUMN "executionState" "ProspectExecutionState";

-- 3) sequence_executions: `queuedAt` (the submit-time confirmation instant) is
--    renamed to `receivedAt` — the server's own acceptance instant, not a
--    queue-entry timestamp Mr Outreach imposed. Add the initial per-prospect
--    state snapshot.
ALTER TABLE "sequence_executions" RENAME COLUMN "queuedAt" TO "receivedAt";
ALTER TABLE "sequence_executions" ADD COLUMN "initialProspectState" "ProspectExecutionState";
