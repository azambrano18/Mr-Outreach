-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SequenceExecutionStatus" ADD VALUE 'PAUSE_REQUESTED';
ALTER TYPE "SequenceExecutionStatus" ADD VALUE 'PAUSED';
ALTER TYPE "SequenceExecutionStatus" ADD VALUE 'RESUME_REQUESTED';
ALTER TYPE "SequenceExecutionStatus" ADD VALUE 'STOP_REQUESTED';
ALTER TYPE "SequenceExecutionStatus" ADD VALUE 'STOPPED';
ALTER TYPE "SequenceExecutionStatus" ADD VALUE 'RESTART_REQUESTED';

-- AlterTable
ALTER TABLE "sequence_executions" ADD COLUMN     "executionAttempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastControlIdempotencyKey" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "previousExecutionId" TEXT,
ADD COLUMN     "resumedAt" TIMESTAMP(3),
ADD COLUMN     "stopReason" TEXT,
ADD COLUMN     "stoppedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "sequence_executions_previousExecutionId_key" ON "sequence_executions"("previousExecutionId");

-- AddForeignKey
ALTER TABLE "sequence_executions" ADD CONSTRAINT "sequence_executions_previousExecutionId_fkey" FOREIGN KEY ("previousExecutionId") REFERENCES "sequence_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
