-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "isSimulation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "simulationBatchId" TEXT,
ADD COLUMN     "simulationScenario" "ConversationResponseOutcome";

-- CreateTable
CREATE TABLE "simulation_conversation_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "simulation_conversation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulation_conversation_batches_organizationId_idx" ON "simulation_conversation_batches"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "simulation_conversation_batches_organizationId_idempotenc_key" ON "simulation_conversation_batches"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "conversations_simulationBatchId_idx" ON "conversations"("simulationBatchId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_simulationBatchId_fkey" FOREIGN KEY ("simulationBatchId") REFERENCES "simulation_conversation_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
