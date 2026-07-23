-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MailboxAdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MailboxConnectionStatus" AS ENUM ('NOT_TESTED', 'TESTING', 'CONNECTED', 'PARTIALLY_CONNECTED', 'CONNECTION_ERROR', 'ENGINE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "MailboxEncryption" AS ENUM ('SSL_TLS', 'STARTTLS', 'NONE');

-- CreateEnum
CREATE TYPE "MailboxAssignmentRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VariableStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VariableSource" AS ENUM ('CONTACT', 'SENDER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DelayUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS', 'BUSINESS_DAYS');

-- CreateEnum
CREATE TYPE "StepSendMode" AS ENUM ('NEW_THREAD', 'REPLY');

-- CreateEnum
CREATE TYPE "SequenceStepStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "replyTo" TEXT,
    "status" "MailboxAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectionStatus" "MailboxConnectionStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestedBy" TEXT,
    "lastTestMessage" TEXT,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "imapEncryption" "MailboxEncryption" NOT NULL,
    "imapUsername" TEXT NOT NULL,
    "imapVerifyCertificate" BOOLEAN NOT NULL DEFAULT true,
    "imapSecretCiphertext" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpEncryption" "MailboxEncryption" NOT NULL,
    "smtpUsername" TEXT NOT NULL,
    "smtpVerifyCertificate" BOOLEAN NOT NULL DEFAULT true,
    "smtpSecretCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MailboxAssignmentRole" NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_connection_tests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "status" "MailboxConnectionStatus" NOT NULL,
    "imapSuccess" BOOLEAN NOT NULL,
    "imapErrorCode" TEXT,
    "smtpSuccess" BOOLEAN NOT NULL,
    "smtpErrorCode" TEXT,
    "message" TEXT NOT NULL,
    "technicalMessage" TEXT NOT NULL,
    "executedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_connection_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "source" "VariableSource" NOT NULL,
    "status" "VariableStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'ACTIVE',
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_versions" (
    "id" TEXT NOT NULL,
    "signatureId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "plainTextContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "signature_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executiveId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_steps" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "htmlHeader" TEXT,
    "htmlBody" TEXT NOT NULL,
    "plainTextBody" TEXT NOT NULL,
    "delayValue" INTEGER NOT NULL,
    "delayUnit" "DelayUnit" NOT NULL,
    "sendMode" "StepSendMode" NOT NULL,
    "status" "SequenceStepStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_step_versions" (
    "id" TEXT NOT NULL,
    "sequenceStepId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "htmlHeader" TEXT,
    "htmlBody" TEXT NOT NULL,
    "plainTextBody" TEXT NOT NULL,
    "delayValue" INTEGER NOT NULL,
    "delayUnit" "DelayUnit" NOT NULL,
    "sendMode" "StepSendMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "sequence_step_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "users"("organizationId", "email");

-- CreateIndex
CREATE INDEX "roles_organizationId_idx" ON "roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_name_key" ON "roles"("organizationId", "name");

-- CreateIndex
CREATE INDEX "mailboxes_organizationId_idx" ON "mailboxes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_organizationId_email_key" ON "mailboxes"("organizationId", "email");

-- CreateIndex
CREATE INDEX "mailbox_assignments_organizationId_idx" ON "mailbox_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "mailbox_assignments_mailboxId_idx" ON "mailbox_assignments"("mailboxId");

-- CreateIndex
CREATE INDEX "mailbox_assignments_userId_idx" ON "mailbox_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_assignments_mailboxId_userId_key" ON "mailbox_assignments"("mailboxId", "userId");

-- CreateIndex
CREATE INDEX "mailbox_connection_tests_mailboxId_idx" ON "mailbox_connection_tests"("mailboxId");

-- CreateIndex
CREATE INDEX "mailbox_connection_tests_organizationId_idx" ON "mailbox_connection_tests"("organizationId");

-- CreateIndex
CREATE INDEX "templates_organizationId_idx" ON "templates"("organizationId");

-- CreateIndex
CREATE INDEX "variables_organizationId_idx" ON "variables"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "variables_organizationId_key_key" ON "variables"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_mailboxId_key" ON "signatures"("mailboxId");

-- CreateIndex
CREATE INDEX "signatures_organizationId_idx" ON "signatures"("organizationId");

-- CreateIndex
CREATE INDEX "signature_versions_signatureId_idx" ON "signature_versions"("signatureId");

-- CreateIndex
CREATE UNIQUE INDEX "signature_versions_signatureId_versionNumber_key" ON "signature_versions"("signatureId", "versionNumber");

-- CreateIndex
CREATE INDEX "sequences_organizationId_idx" ON "sequences"("organizationId");

-- CreateIndex
CREATE INDEX "sequences_executiveId_idx" ON "sequences"("executiveId");

-- CreateIndex
CREATE INDEX "sequence_steps_organizationId_idx" ON "sequence_steps"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_steps_sequenceId_idx" ON "sequence_steps"("sequenceId");

-- CreateIndex
CREATE INDEX "sequence_step_versions_sequenceStepId_idx" ON "sequence_step_versions"("sequenceStepId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_step_versions_sequenceStepId_versionNumber_key" ON "sequence_step_versions"("sequenceStepId", "versionNumber");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_idx" ON "audit_logs"("organizationId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_assignments" ADD CONSTRAINT "mailbox_assignments_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_assignments" ADD CONSTRAINT "mailbox_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_connection_tests" ADD CONSTRAINT "mailbox_connection_tests_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variables" ADD CONSTRAINT "variables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_versions" ADD CONSTRAINT "signature_versions_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "signatures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_executiveId_fkey" FOREIGN KEY ("executiveId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_step_versions" ADD CONSTRAINT "sequence_step_versions_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "sequence_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum (AdminReorg — client hierarchy gains real Postgres tables)
CREATE TYPE "ManagedClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClientAssignmentRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "MailboxProvisioningStatus" AS ENUM ('NOT_PROVISIONED', 'PROVISION_REQUESTED', 'PROVISIONING', 'PROVISIONED', 'PROVISION_FAILED');

-- CreateTable
CREATE TABLE "managed_clients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crmClientId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "internalCode" TEXT,
    "industry" TEXT,
    "status" "ManagedClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "logoUrl" TEXT,
    "startDate" TIMESTAMP(3),
    "supervisorUserId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "managed_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_executive_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClientAssignmentRole" NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_executive_assignments_pkey" PRIMARY KEY ("id")
);

-- AlterTable (Mailbox gains the clientId/domainId/provisioning columns the domain entity already assumed)
ALTER TABLE "mailboxes"
    ADD COLUMN "clientId" TEXT,
    ADD COLUMN "domainId" TEXT,
    ADD COLUMN "provisioningStatus" "MailboxProvisioningStatus" NOT NULL DEFAULT 'NOT_PROVISIONED',
    ADD COLUMN "lastProvisionCommandId" TEXT,
    ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Santiago',
    ADD COLUMN "dailyLimit" INTEGER NOT NULL DEFAULT 40,
    ADD COLUMN "minimumIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN "maximumIntervalSeconds" INTEGER NOT NULL DEFAULT 180;

-- CreateIndex
CREATE UNIQUE INDEX "managed_clients_organizationId_crmClientId_key" ON "managed_clients"("organizationId", "crmClientId");

-- CreateIndex
CREATE INDEX "managed_clients_organizationId_idx" ON "managed_clients"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "domains_organizationId_domainName_key" ON "domains"("organizationId", "domainName");

-- CreateIndex
CREATE INDEX "domains_organizationId_idx" ON "domains"("organizationId");

-- CreateIndex
CREATE INDEX "domains_clientId_idx" ON "domains"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_executive_assignments_clientId_userId_key" ON "client_executive_assignments"("clientId", "userId");

-- CreateIndex
CREATE INDEX "client_executive_assignments_organizationId_idx" ON "client_executive_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "mailboxes_clientId_idx" ON "mailboxes"("clientId");

-- CreateIndex
CREATE INDEX "mailboxes_domainId_idx" ON "mailboxes"("domainId");

-- AddForeignKey
ALTER TABLE "managed_clients" ADD CONSTRAINT "managed_clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_executive_assignments" ADD CONSTRAINT "client_executive_assignments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_executive_assignments" ADD CONSTRAINT "client_executive_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

