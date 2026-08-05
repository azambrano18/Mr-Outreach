-- Persist Sequence.clientId for real. Previously the column did not exist
-- at all under Postgres: PrismaSequenceRepository hardcoded clientId to
-- null on every read and silently dropped it on every write, even though
-- the application layer (SequencesService.update, GenerateSimulationConversationsUseCase,
-- DevSeedService) always tried to set it whenever the sender mailbox changed.
-- This blocked SchedulingService.enrollAcceptedContacts (ResponseOutcomeService's
-- "Deriva"/REFERRED outcome, and legacy sequence-contact imports) for any
-- Sequence persisted under Postgres, real or QA.
--
-- Nullable, mirroring Mailbox.clientId: a sequence with no sender account
-- yet ("Pendiente de clasificación") has no client either.

-- AlterTable
ALTER TABLE "sequences" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE INDEX "sequences_clientId_idx" ON "sequences"("clientId");

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: for every pre-existing sequence that already has a sender
-- mailbox, its clientId is unambiguously that mailbox's own clientId — this
-- is the exact invariant SequencesService.update() has always tried to
-- maintain (see the domain entity's doc comment), just never able to
-- persist it. Sequences without a mailbox yet are left null ("Pendiente de
-- clasificación"), never guessed. Idempotent — only touches rows still null.
UPDATE "sequences" AS s
SET "clientId" = m."clientId"
FROM "mailboxes" AS m
WHERE s."mailboxId" = m.id
  AND s."clientId" IS NULL
  AND m."clientId" IS NOT NULL;
