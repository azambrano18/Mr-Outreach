-- Migración aditiva — fase "Conversaciones persistentes y atribución al flujo
-- activo". No elimina tablas, columnas ni renombra nada legacy. Contenido:
--   1) 6 tablas nuevas para Conversaciones (antes solo en memoria de proceso,
--      incluso con PERSISTENCE_DRIVER=postgres — ver persistence.module.ts).
--   2) Domain.serverDomainId — la identidad real (antes solo existía como
--      snapshot en Mailbox.serverDomainId, que se mantiene intacto).
--   3) ProspectImportRow.companyId/contactId/resolvedAt — para que el flujo
--      activo de Gestiones pueda resolver/crear Company/Contact reutilizando
--      las tablas ya existentes (ProspectIdentityResolver).
--   4) IntegrationAggregateType +TEMPLATE/+EXECUTION — Alternativa A: adapta
--      el Outbox/Inbox existente para el flujo activo en vez de crear uno
--      paralelo. Sin columnas commandId/correlationId nuevas en
--      SequenceTemplateVersion/SequenceExecution — se consultan por
--      (organizationId, aggregateType, aggregateId).
-- Solo aplicar con `prisma migrate deploy`, nunca `db push`, y nunca todavía
-- contra el branch `production` sin autorización expresa.

-- CreateEnum
CREATE TYPE "ConversationManagementStatus" AS ENUM ('NEW', 'PENDING', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConversationClassification" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'REQUESTS_INFORMATION', 'FOLLOW_UP_LATER', 'WRONG_CONTACT', 'OUT_OF_OFFICE', 'AUTOMATIC_REPLY', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'UNSUBSCRIBE', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "ConversationResponseOutcome" AS ENUM ('NOT_INTERESTED', 'DO_NOT_CONTACT', 'INTERESTED', 'REFERRED');

-- CreateEnum
CREATE TYPE "ConversationOrigin" AS ENUM ('ACTIVE_EXECUTION', 'LEGACY_SEQUENCE', 'EXTERNAL_INBOUND');

-- CreateEnum
CREATE TYPE "ConversationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ConversationMessageType" AS ENUM ('HUMAN_REPLY', 'OUTREACH_EMAIL', 'AUTO_REPLY', 'OUT_OF_OFFICE', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'UNSUBSCRIBE', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationAggregateType" ADD VALUE 'TEMPLATE';
ALTER TYPE "IntegrationAggregateType" ADD VALUE 'EXECUTION';

-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "serverDomainId" TEXT;

-- AlterTable
ALTER TABLE "prospect_import_rows" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "contactId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "domainId" TEXT,
    "mailboxId" TEXT NOT NULL,
    "emailThreadId" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT,
    "companyNameSnapshot" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "origin" "ConversationOrigin" NOT NULL,
    "sequenceContactId" TEXT,
    "originatingScheduledEmailId" TEXT,
    "sequenceId" TEXT,
    "sequenceStepId" TEXT,
    "sequenceExecutionId" TEXT,
    "prospectImportRowId" TEXT,
    "assignedExecutiveId" TEXT,
    "subject" TEXT NOT NULL,
    "managementStatus" "ConversationManagementStatus" NOT NULL DEFAULT 'NEW',
    "classification" "ConversationClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "responseOutcome" "ConversationResponseOutcome",
    "isUnread" BOOLEAN NOT NULL DEFAULT true,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "direction" "ConversationDirection" NOT NULL,
    "serverMessageId" TEXT,
    "outboundMessageId" TEXT,
    "messageIdHeader" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "cc" JSONB NOT NULL DEFAULT '[]',
    "bcc" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "plainTextBody" TEXT NOT NULL,
    "stepNumber" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "messageType" "ConversationMessageType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_tag_assignments" (
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_tag_assignments_pkey" PRIMARY KEY ("conversationId","tagId")
);

-- CreateTable
CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "responseOutcome" "ConversationResponseOutcome",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_read_states" (
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_read_states_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateIndex
CREATE INDEX "conversations_organizationId_idx" ON "conversations"("organizationId");

-- CreateIndex
CREATE INDEX "conversations_clientId_idx" ON "conversations"("clientId");

-- CreateIndex
CREATE INDEX "conversations_mailboxId_idx" ON "conversations"("mailboxId");

-- CreateIndex
CREATE INDEX "conversations_assignedExecutiveId_idx" ON "conversations"("assignedExecutiveId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_classification_idx" ON "conversations"("organizationId", "classification");

-- CreateIndex
CREATE INDEX "conversations_organizationId_managementStatus_idx" ON "conversations"("organizationId", "managementStatus");

-- CreateIndex
CREATE INDEX "conversations_sequenceExecutionId_idx" ON "conversations"("sequenceExecutionId");

-- CreateIndex
CREATE INDEX "conversations_prospectImportRowId_idx" ON "conversations"("prospectImportRowId");

-- CreateIndex
CREATE INDEX "conversations_sequenceContactId_idx" ON "conversations"("sequenceContactId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_mailboxId_emailThreadId_key" ON "conversations"("mailboxId", "emailThreadId");

-- CreateIndex
CREATE INDEX "conversation_messages_organizationId_idx" ON "conversation_messages"("organizationId");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_idx" ON "conversation_messages"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_emailMessageId_key" ON "conversation_messages"("conversationId", "emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_organizationId_messageIdHeader_key" ON "conversation_messages"("organizationId", "messageIdHeader");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_organizationId_serverMessageId_key" ON "conversation_messages"("organizationId", "serverMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_organizationId_outboundMessageId_key" ON "conversation_messages"("organizationId", "outboundMessageId");

-- CreateIndex
CREATE INDEX "conversation_tags_organizationId_idx" ON "conversation_tags"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tags_organizationId_name_key" ON "conversation_tags"("organizationId", "name");

-- CreateIndex
CREATE INDEX "conversation_tag_assignments_organizationId_idx" ON "conversation_tag_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "conversation_tag_assignments_tagId_idx" ON "conversation_tag_assignments"("tagId");

-- CreateIndex
CREATE INDEX "conversation_notes_organizationId_idx" ON "conversation_notes"("organizationId");

-- CreateIndex
CREATE INDEX "conversation_notes_conversationId_idx" ON "conversation_notes"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_read_states_organizationId_idx" ON "conversation_read_states"("organizationId");

-- CreateIndex
CREATE INDEX "conversation_read_states_userId_idx" ON "conversation_read_states"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "domains_organizationId_serverDomainId_key" ON "domains"("organizationId", "serverDomainId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_companyId_idx" ON "prospect_import_rows"("companyId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_contactId_idx" ON "prospect_import_rows"("contactId");

-- AddForeignKey
ALTER TABLE "prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sequenceContactId_fkey" FOREIGN KEY ("sequenceContactId") REFERENCES "sequence_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_originatingScheduledEmailId_fkey" FOREIGN KEY ("originatingScheduledEmailId") REFERENCES "scheduled_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "sequence_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sequenceExecutionId_fkey" FOREIGN KEY ("sequenceExecutionId") REFERENCES "sequence_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_prospectImportRowId_fkey" FOREIGN KEY ("prospectImportRowId") REFERENCES "prospect_import_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedExecutiveId_fkey" FOREIGN KEY ("assignedExecutiveId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "conversation_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

