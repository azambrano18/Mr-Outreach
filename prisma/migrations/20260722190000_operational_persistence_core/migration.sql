-- CreateEnum
CREATE TYPE "IntegrationCommandStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "IntegrationAggregateType" AS ENUM ('MAILBOX', 'SEQUENCE', 'SEQUENCE_IMPORT', 'SEQUENCE_CONTACT', 'SEQUENCE_COMPANY');

-- CreateEnum
CREATE TYPE "IntegrationEventProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationEventOrigin" AS ENUM ('SIMULATED', 'REMOTE');

-- CreateEnum
CREATE TYPE "SequenceImportStatus" AS ENUM ('UPLOADED', 'MAPPING_REQUIRED', 'VALIDATING', 'READY', 'SUBMITTED', 'ACCEPTED', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SequenceImportScenario" AS ENUM ('ALL_ACCEPTED', 'WITH_DUPLICATES', 'WITH_INVALID', 'WITH_EXCLUDED', 'PARTIALLY_COMPLETED', 'FAILED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "SequenceImportRowValidationStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "SequenceContactStatus" AS ENUM ('PENDING', 'ACTIVE', 'SCHEDULED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'COMPLETED', 'COMPLETED_MANUALLY', 'PAUSED', 'REMOVED', 'ERROR');

-- CreateEnum
CREATE TYPE "ScheduledEmailStatus" AS ENUM ('PENDING', 'SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'RETRY_SCHEDULED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduledEmailPriority" AS ENUM ('FOLLOW_UP', 'NEW_CONTACT');

-- CreateTable
CREATE TABLE "integration_commands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "aggregateType" "IntegrationAggregateType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IntegrationCommandStatus" NOT NULL DEFAULT 'REQUESTED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "integration_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "commandId" TEXT,
    "correlationId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IntegrationEventProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "origin" "IntegrationEventOrigin" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressedAt" TIMESTAMP(3),
    "suppressedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "jobTitle" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "country" TEXT,
    "website" TEXT,
    "linkedin" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressedAt" TIMESTAMP(3),
    "suppressedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "executiveId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "status" "SequenceImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "columnMapping" JSONB,
    "scenario" "SequenceImportScenario",
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "excludedRows" INTEGER NOT NULL DEFAULT 0,
    "companiesDetected" INTEGER NOT NULL DEFAULT 0,
    "contactsAccepted" INTEGER NOT NULL DEFAULT 0,
    "contactsRejected" INTEGER NOT NULL DEFAULT 0,
    "rejections" JSONB NOT NULL DEFAULT '[]',
    "commandId" TEXT,
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_import_rows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "companyRawName" TEXT,
    "email" TEXT,
    "validationStatus" "SequenceImportRowValidationStatus" NOT NULL,
    "validationErrors" JSONB NOT NULL DEFAULT '[]',
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "sequenceVersion" INTEGER NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceImportId" TEXT,
    "assignedMailboxId" TEXT NOT NULL,
    "assignedExecutiveId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "currentStepPosition" INTEGER,
    "status" "SequenceContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextScheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_emails" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "sequenceVersion" INTEGER NOT NULL,
    "sequenceContactId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "sequenceStepId" TEXT NOT NULL,
    "stepVersion" INTEGER NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledEmailStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "ScheduledEmailPriority" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "lastError" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "subjectSnapshot" TEXT,
    "htmlBodySnapshot" TEXT,
    "plainTextBodySnapshot" TEXT,
    "signatureSnapshot" TEXT,
    "messageIdHeader" TEXT,
    "inReplyTo" TEXT,
    "referencesHeader" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_commands_commandId_key" ON "integration_commands"("commandId");

-- CreateIndex
CREATE INDEX "integration_commands_organizationId_idx" ON "integration_commands"("organizationId");

-- CreateIndex
CREATE INDEX "integration_commands_organizationId_status_idx" ON "integration_commands"("organizationId", "status");

-- CreateIndex
CREATE INDEX "integration_commands_organizationId_aggregateType_aggregate_idx" ON "integration_commands"("organizationId", "aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "integration_commands_correlationId_idx" ON "integration_commands"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_commands_organizationId_idempotencyKey_key" ON "integration_commands"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "integration_events_organizationId_idx" ON "integration_events"("organizationId");

-- CreateIndex
CREATE INDEX "integration_events_organizationId_status_idx" ON "integration_events"("organizationId", "status");

-- CreateIndex
CREATE INDEX "integration_events_commandId_idx" ON "integration_events"("commandId");

-- CreateIndex
CREATE INDEX "integration_events_correlationId_idx" ON "integration_events"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_organizationId_eventId_origin_key" ON "integration_events"("organizationId", "eventId", "origin");

-- CreateIndex
CREATE INDEX "companies_organizationId_idx" ON "companies"("organizationId");

-- CreateIndex
CREATE INDEX "companies_organizationId_clientId_idx" ON "companies"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_idx" ON "contacts"("organizationId");

-- CreateIndex
CREATE INDEX "contacts_organizationId_clientId_idx" ON "contacts"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- CreateIndex
CREATE INDEX "sequence_imports_organizationId_idx" ON "sequence_imports"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_imports_organizationId_sequenceId_idx" ON "sequence_imports"("organizationId", "sequenceId");

-- CreateIndex
CREATE INDEX "sequence_imports_organizationId_status_idx" ON "sequence_imports"("organizationId", "status");

-- CreateIndex
CREATE INDEX "sequence_import_rows_organizationId_idx" ON "sequence_import_rows"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_import_rows_importId_idx" ON "sequence_import_rows"("importId");

-- CreateIndex
CREATE INDEX "sequence_import_rows_importId_validationStatus_idx" ON "sequence_import_rows"("importId", "validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_import_rows_importId_rowNumber_key" ON "sequence_import_rows"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "sequence_contacts_organizationId_idx" ON "sequence_contacts"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_contacts_organizationId_status_idx" ON "sequence_contacts"("organizationId", "status");

-- CreateIndex
CREATE INDEX "sequence_contacts_organizationId_sequenceId_idx" ON "sequence_contacts"("organizationId", "sequenceId");

-- CreateIndex
CREATE INDEX "sequence_contacts_contactId_idx" ON "sequence_contacts"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_contacts_sequenceId_contactId_key" ON "sequence_contacts"("sequenceId", "contactId");

-- CreateIndex
CREATE INDEX "scheduled_emails_organizationId_idx" ON "scheduled_emails"("organizationId");

-- CreateIndex
CREATE INDEX "scheduled_emails_organizationId_status_idx" ON "scheduled_emails"("organizationId", "status");

-- CreateIndex
CREATE INDEX "scheduled_emails_organizationId_scheduledAt_idx" ON "scheduled_emails"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "scheduled_emails_organizationId_sequenceId_idx" ON "scheduled_emails"("organizationId", "sequenceId");

-- CreateIndex
CREATE INDEX "scheduled_emails_sequenceContactId_idx" ON "scheduled_emails"("sequenceContactId");

-- CreateIndex
CREATE INDEX "scheduled_emails_mailboxId_idx" ON "scheduled_emails"("mailboxId");

-- CreateIndex
CREATE INDEX "scheduled_emails_batchId_idx" ON "scheduled_emails"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_emails_organizationId_idempotencyKey_key" ON "scheduled_emails"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "integration_commands" ADD CONSTRAINT "integration_commands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "integration_commands"("commandId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_imports" ADD CONSTRAINT "sequence_imports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_imports" ADD CONSTRAINT "sequence_imports_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_imports" ADD CONSTRAINT "sequence_imports_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_imports" ADD CONSTRAINT "sequence_imports_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_import_rows" ADD CONSTRAINT "sequence_import_rows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_import_rows" ADD CONSTRAINT "sequence_import_rows_importId_fkey" FOREIGN KEY ("importId") REFERENCES "sequence_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_import_rows" ADD CONSTRAINT "sequence_import_rows_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "sequence_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_sequenceContactId_fkey" FOREIGN KEY ("sequenceContactId") REFERENCES "sequence_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "sequence_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manually added (Prisma has no declarative syntax for partial/expression
-- unique indexes) — mirrors the exact uniqueness already enforced by
-- InMemoryCompanyRepository.findByNormalizedName / InMemoryContactRepository.findByEmail:
-- conditional on the row not being soft-deleted, and case-insensitive for email.
CREATE UNIQUE INDEX "companies_org_client_normalized_active_key" ON "companies"("organizationId", "clientId", "normalizedName") WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "contacts_org_client_email_ci_active_key" ON "contacts"("organizationId", "clientId", LOWER("email")) WHERE "deletedAt" IS NULL;

