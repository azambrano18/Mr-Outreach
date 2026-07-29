-- Etapa "cuenta del ejecutivo" — additive-only migration. New tables only;
-- no existing table (Sequence/SequenceStep/SequenceContact/ScheduledEmail/
-- Mailbox/ManagedClient/Domain) is altered. SequenceTemplate/
-- SequenceExecution intentionally do NOT reuse Sequence/SequenceStep: those
-- keep backing the admin "Secuencias" monitor and the old wizard exactly
-- as before. Railway ("el motor") computes and performs the actual sends
-- for a Gestión, so no ScheduledEmail-equivalent table is added here.

-- CreateEnum
CREATE TYPE "SequenceTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SequenceTemplateStepDelayUnit" AS ENUM ('MINUTES', 'HOURS', 'CALENDAR_DAYS', 'BUSINESS_DAYS');

-- CreateEnum
CREATE TYPE "SequenceTemplateStepDelayReference" AS ENUM ('EXECUTION_START', 'PREVIOUS_STEP');

-- CreateEnum
CREATE TYPE "SequenceTemplateVersionStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SequenceExecutionStatus" AS ENUM ('DRAFT', 'VALIDATING', 'READY', 'SUBMITTING', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SequenceExecutionServerStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'PROCESSING', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProspectImportStatus" AS ENUM ('UPLOADED', 'MAPPING_REQUIRED', 'VALIDATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ProspectImportRowValidationStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE');

-- CreateTable
CREATE TABLE "sequence_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SequenceTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentDraftVersion" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santiago',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "sequence_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sequence_templates_organizationId_idx" ON "sequence_templates"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_templates_organizationId_ownerUserId_idx" ON "sequence_templates"("organizationId", "ownerUserId");

-- CreateIndex
CREATE INDEX "sequence_templates_mailboxId_idx" ON "sequence_templates"("mailboxId");

-- CreateTable
CREATE TABLE "sequence_template_steps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subjectTemplate" TEXT NOT NULL DEFAULT '',
    "headerHtml" TEXT,
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "delayValue" INTEGER NOT NULL DEFAULT 0,
    "delayUnit" "SequenceTemplateStepDelayUnit" NOT NULL DEFAULT 'BUSINESS_DAYS',
    "delayReference" "SequenceTemplateStepDelayReference" NOT NULL DEFAULT 'PREVIOUS_STEP',
    "allowedWeekdays" JSONB NOT NULL DEFAULT '["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]',
    "sendWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "sendWindowEnd" TEXT NOT NULL DEFAULT '17:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_template_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sequence_template_steps_organizationId_idx" ON "sequence_template_steps"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_template_steps_templateId_idx" ON "sequence_template_steps"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_template_steps_templateId_stepNumber_key" ON "sequence_template_steps"("templateId", "stepNumber");

-- CreateTable
CREATE TABLE "sequence_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "signatureHtml" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "status" "SequenceTemplateVersionStatus" NOT NULL DEFAULT 'REQUESTED',
    "serverTemplateId" TEXT,
    "templateTokenCiphertext" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "lastPublishCommandId" TEXT,
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sequence_template_versions_serverTemplateId_key" ON "sequence_template_versions"("serverTemplateId");

-- CreateIndex
CREATE INDEX "sequence_template_versions_templateId_idx" ON "sequence_template_versions"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_template_versions_templateId_versionNumber_key" ON "sequence_template_versions"("templateId", "versionNumber");

-- CreateTable
CREATE TABLE "sequence_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executiveId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "status" "SequenceExecutionStatus" NOT NULL DEFAULT 'DRAFT',
    "prospectImportId" TEXT,
    "serverStatus" "SequenceExecutionServerStatus",
    "currentStepNumber" INTEGER,
    "sentCount" INTEGER,
    "pendingCount" INTEGER,
    "failedCount" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "serverExecutionId" TEXT,
    "executionTokenCiphertext" TEXT,
    "lastSubmitCommandId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sequence_executions_prospectImportId_key" ON "sequence_executions"("prospectImportId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_executions_serverExecutionId_key" ON "sequence_executions"("serverExecutionId");

-- CreateIndex
CREATE INDEX "sequence_executions_organizationId_idx" ON "sequence_executions"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_executions_organizationId_executiveId_idx" ON "sequence_executions"("organizationId", "executiveId");

-- CreateIndex
CREATE INDEX "sequence_executions_templateId_idx" ON "sequence_executions"("templateId");

-- CreateIndex
CREATE INDEX "sequence_executions_mailboxId_idx" ON "sequence_executions"("mailboxId");

-- CreateTable
CREATE TABLE "prospect_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ProspectImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "columnMapping" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "excludedRows" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospect_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospect_imports_executionId_key" ON "prospect_imports"("executionId");

-- CreateIndex
CREATE INDEX "prospect_imports_organizationId_idx" ON "prospect_imports"("organizationId");

-- CreateTable
CREATE TABLE "prospect_import_rows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "validationStatus" "ProspectImportRowValidationStatus" NOT NULL,
    "validationErrors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prospect_import_rows_organizationId_idx" ON "prospect_import_rows"("organizationId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_importId_idx" ON "prospect_import_rows"("importId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_importId_validationStatus_idx" ON "prospect_import_rows"("importId", "validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_import_rows_importId_rowNumber_key" ON "prospect_import_rows"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "sequence_templates" ADD CONSTRAINT "sequence_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_templates" ADD CONSTRAINT "sequence_templates_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_templates" ADD CONSTRAINT "sequence_templates_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_template_steps" ADD CONSTRAINT "sequence_template_steps_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sequence_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_template_versions" ADD CONSTRAINT "sequence_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sequence_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_executions" ADD CONSTRAINT "sequence_executions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_executions" ADD CONSTRAINT "sequence_executions_executiveId_fkey" FOREIGN KEY ("executiveId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_executions" ADD CONSTRAINT "sequence_executions_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_executions" ADD CONSTRAINT "sequence_executions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "sequence_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_executions" ADD CONSTRAINT "sequence_executions_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "sequence_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_imports" ADD CONSTRAINT "prospect_imports_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "sequence_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_importId_fkey" FOREIGN KEY ("importId") REFERENCES "prospect_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
