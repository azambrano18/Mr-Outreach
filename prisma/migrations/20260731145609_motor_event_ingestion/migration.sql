-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationEventProcessingStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "IntegrationEventProcessingStatus" ADD VALUE 'FAILED_RETRYABLE';
ALTER TYPE "IntegrationEventProcessingStatus" ADD VALUE 'FAILED_TERMINAL';

-- AlterTable
ALTER TABLE "integration_events" ADD COLUMN     "aggregateId" TEXT,
ADD COLUMN     "aggregateType" "IntegrationAggregateType",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "occurredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "integration_events_aggregateType_aggregateId_idx" ON "integration_events"("aggregateType", "aggregateId");
