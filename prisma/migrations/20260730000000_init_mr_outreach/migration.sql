-- Migración inicial consolidada para el proyecto Neon "Mr Outreach" (base
-- de datos nueva y exclusiva, sin dependencia del CRM/portal externo).
-- Reemplaza la cadena histórica de 13 migraciones incrementales que
-- evolucionaron el esquema en la base anterior (compartida con
-- "Mejoreferido"/maestro_clientes) — generada aquí desde un estado vacío
-- hasta el `schema.prisma` actual, ya sin ninguna columna/tabla relacionada
-- al CRM. Solo aplicar con `prisma migrate deploy`, nunca `db push`, y nunca
-- todavía contra el branch `production` sin autorización expresa.

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MailboxAdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MailboxLinkSource" AS ENUM ('LEGACY_LOCAL', 'SERVER_TOKEN');

-- CreateEnum
CREATE TYPE "MailboxLinkStatus" AS ENUM ('LINK_PENDING', 'ACTIVE', 'UNLINK_REQUESTED', 'REVOKED', 'LINK_ERROR', 'LEGACY');

-- CreateEnum
CREATE TYPE "MailboxServerTechnicalStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED', 'DISABLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MailboxConnectionStatus" AS ENUM ('NOT_TESTED', 'TESTING', 'CONNECTED', 'PARTIALLY_CONNECTED', 'CONNECTION_ERROR', 'ENGINE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "MailboxEncryption" AS ENUM ('SSL_TLS', 'STARTTLS', 'NONE');

-- CreateEnum
CREATE TYPE "MailboxProvisioningStatus" AS ENUM ('NOT_PROVISIONED', 'PROVISION_REQUESTED', 'PROVISIONING', 'PROVISIONED', 'PROVISION_FAILED');

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
CREATE TYPE "SignatureAssetStatus" AS ENUM ('AVAILABLE', 'REFERENCED', 'ORPHANED', 'DELETED');

-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SequencePublishStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'PROCESSING', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DelayUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS', 'BUSINESS_DAYS');

-- CreateEnum
CREATE TYPE "StepSendMode" AS ENUM ('NEW_THREAD', 'REPLY');

-- CreateEnum
CREATE TYPE "SequenceStepStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ManagedClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ManagedClientSource" AS ENUM ('SERVER', 'MANUAL');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClientAssignmentRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "ClientVisibilitySource" AS ENUM ('MANUAL', 'MAILBOX_DERIVED');

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

-- CreateEnum
CREATE TYPE "SequenceTemplateStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SequenceTemplateStepDelayUnit" AS ENUM ('MINUTES', 'HOURS', 'CALENDAR_DAYS', 'BUSINESS_DAYS');

-- CreateEnum
CREATE TYPE "SequenceTemplateStepDelayReference" AS ENUM ('EXECUTION_START', 'PREVIOUS_STEP');

-- CreateEnum
CREATE TYPE "SequenceTemplateVersionStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SequenceExecutionStatus" AS ENUM ('DRAFT', 'VALIDATING', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SequenceExecutionServerStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProspectImportStatus" AS ENUM ('UPLOADED', 'MAPPING_REQUIRED', 'VALIDATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ProspectImportRowValidationStatus" AS ENUM ('VALID', 'INVALID', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ProspectExecutionState" AS ENUM ('STEP_01_PENDING', 'STEP_01_PROCESSING', 'STEP_01_SENT', 'STEP_02_PENDING', 'STEP_02_PROCESSING', 'STEP_02_SENT', 'STEP_03_PENDING', 'STEP_03_PROCESSING', 'STEP_03_SENT', 'COMPLETED', 'FAILED');

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
    "clientId" TEXT,
    "domainId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "replyTo" TEXT,
    "status" "MailboxAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectionStatus" "MailboxConnectionStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestedBy" TEXT,
    "lastTestMessage" TEXT,
    "provisioningStatus" "MailboxProvisioningStatus" NOT NULL DEFAULT 'NOT_PROVISIONED',
    "lastProvisionCommandId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santiago',
    "dailyLimit" INTEGER NOT NULL DEFAULT 40,
    "minimumIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "maximumIntervalSeconds" INTEGER NOT NULL DEFAULT 180,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "imapEncryption" "MailboxEncryption",
    "imapUsername" TEXT,
    "imapVerifyCertificate" BOOLEAN DEFAULT true,
    "imapSecretCiphertext" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpEncryption" "MailboxEncryption",
    "smtpUsername" TEXT,
    "smtpVerifyCertificate" BOOLEAN DEFAULT true,
    "smtpSecretCiphertext" TEXT,
    "linkSource" "MailboxLinkSource" NOT NULL DEFAULT 'LEGACY_LOCAL',
    "linkStatus" "MailboxLinkStatus" NOT NULL DEFAULT 'LEGACY',
    "serverMailboxId" TEXT,
    "serverDomainId" TEXT,
    "serverClientId" TEXT,
    "serverRedemptionId" TEXT,
    "tokenFingerprint" TEXT,
    "emailSnapshot" TEXT,
    "domainSnapshot" TEXT,
    "clientNameSnapshot" TEXT,
    "serverStatusSnapshot" "MailboxServerTechnicalStatus",
    "serverCanSendSnapshot" BOOLEAN,
    "serverStatusCheckedAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "linkedBy" TEXT,
    "unlinkRequestedAt" TIMESTAMP(3),
    "unlinkRequestedBy" TEXT,
    "unlinkReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationId" TEXT,
    "lastLinkCommandId" TEXT,
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
CREATE TABLE "signature_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "SignatureAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "signature_assets_pkey" PRIMARY KEY ("id")
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
    "publishStatus" "SequencePublishStatus",
    "sequenceVersion" INTEGER NOT NULL DEFAULT 0,
    "effectiveStartAt" TIMESTAMP(3),
    "lastPublishedAt" TIMESTAMP(3),
    "lastPublishCommandId" TEXT,
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

-- CreateTable
CREATE TABLE "managed_clients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "ManagedClientSource" NOT NULL DEFAULT 'SERVER',
    "serverClientId" TEXT,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "internalCode" TEXT,
    "industry" TEXT,
    "status" "ManagedClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "logoUrl" TEXT,
    "startDate" TIMESTAMP(3),
    "supervisorUserId" TEXT,
    "notes" TEXT,
    "clientRutSnapshot" TEXT,
    "externalStatusSnapshot" TEXT,
    "externalStatusCheckedAt" TIMESTAMP(3),
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
    "visibilitySource" "ClientVisibilitySource" NOT NULL DEFAULT 'MANUAL',
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_executive_assignments_pkey" PRIMARY KEY ("id")
);

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
    "payloadHash" TEXT,
    "resultSnapshot" JSONB,
    "httpStatusCode" INTEGER,

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

-- CreateTable
CREATE TABLE "sequence_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectTemplate" TEXT NOT NULL DEFAULT '',
    "headerText" TEXT,
    "signatureHtml" TEXT NOT NULL DEFAULT '',
    "status" "SequenceTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentDraftVersion" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'America/Santiago',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sequence_templates_pkey" PRIMARY KEY ("id")
);

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
    "headerText" TEXT,
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

-- CreateTable
CREATE TABLE "sequence_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "headerText" TEXT,
    "signatureHtml" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "status" "SequenceTemplateVersionStatus" NOT NULL DEFAULT 'REQUESTED',
    "serverTemplateId" TEXT,
    "templateTokenCiphertext" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "lastPublishCommandId" TEXT,
    "lastError" TEXT,
    "previousVersionNumber" INTEGER,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executiveId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "name" TEXT,
    "timezone" TEXT NOT NULL,
    "status" "SequenceExecutionStatus" NOT NULL DEFAULT 'DRAFT',
    "prospectImportId" TEXT,
    "requestedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "estimatedStartAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "serverStatus" "SequenceExecutionServerStatus",
    "currentStepNumber" INTEGER,
    "sentCount" INTEGER,
    "pendingCount" INTEGER,
    "failedCount" INTEGER,
    "receivedProspects" INTEGER,
    "acceptedProspects" INTEGER,
    "rejectedProspects" INTEGER,
    "initialProspectState" "ProspectExecutionState",
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "serverExecutionId" TEXT,
    "executionTokenCiphertext" TEXT,
    "lastSubmissionIdempotencyKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_executions_pkey" PRIMARY KEY ("id")
);

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
    "executionState" "ProspectExecutionState",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_import_rows_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "mailboxes_serverMailboxId_key" ON "mailboxes"("serverMailboxId");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_serverRedemptionId_key" ON "mailboxes"("serverRedemptionId");

-- CreateIndex
CREATE INDEX "mailboxes_organizationId_idx" ON "mailboxes"("organizationId");

-- CreateIndex
CREATE INDEX "mailboxes_clientId_idx" ON "mailboxes"("clientId");

-- CreateIndex
CREATE INDEX "mailboxes_domainId_idx" ON "mailboxes"("domainId");

-- CreateIndex
CREATE INDEX "mailboxes_linkStatus_idx" ON "mailboxes"("linkStatus");

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
CREATE UNIQUE INDEX "signature_assets_objectKey_key" ON "signature_assets"("objectKey");

-- CreateIndex
CREATE INDEX "signature_assets_organizationId_idx" ON "signature_assets"("organizationId");

-- CreateIndex
CREATE INDEX "signature_assets_status_idx" ON "signature_assets"("status");

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

-- CreateIndex
CREATE UNIQUE INDEX "managed_clients_serverClientId_key" ON "managed_clients"("serverClientId");

-- CreateIndex
CREATE INDEX "managed_clients_organizationId_idx" ON "managed_clients"("organizationId");

-- CreateIndex
CREATE INDEX "domains_organizationId_idx" ON "domains"("organizationId");

-- CreateIndex
CREATE INDEX "domains_clientId_idx" ON "domains"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "domains_organizationId_domainName_key" ON "domains"("organizationId", "domainName");

-- CreateIndex
CREATE INDEX "client_executive_assignments_organizationId_idx" ON "client_executive_assignments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "client_executive_assignments_clientId_userId_key" ON "client_executive_assignments"("clientId", "userId");

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

-- CreateIndex
CREATE INDEX "sequence_templates_organizationId_idx" ON "sequence_templates"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_templates_organizationId_ownerUserId_idx" ON "sequence_templates"("organizationId", "ownerUserId");

-- CreateIndex
CREATE INDEX "sequence_templates_mailboxId_idx" ON "sequence_templates"("mailboxId");

-- CreateIndex
CREATE INDEX "sequence_template_steps_organizationId_idx" ON "sequence_template_steps"("organizationId");

-- CreateIndex
CREATE INDEX "sequence_template_steps_templateId_idx" ON "sequence_template_steps"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_template_steps_templateId_stepNumber_key" ON "sequence_template_steps"("templateId", "stepNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_template_versions_serverTemplateId_key" ON "sequence_template_versions"("serverTemplateId");

-- CreateIndex
CREATE INDEX "sequence_template_versions_templateId_idx" ON "sequence_template_versions"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_template_versions_templateId_versionNumber_key" ON "sequence_template_versions"("templateId", "versionNumber");

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

-- CreateIndex
CREATE UNIQUE INDEX "prospect_imports_executionId_key" ON "prospect_imports"("executionId");

-- CreateIndex
CREATE INDEX "prospect_imports_organizationId_idx" ON "prospect_imports"("organizationId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_organizationId_idx" ON "prospect_import_rows"("organizationId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_importId_idx" ON "prospect_import_rows"("importId");

-- CreateIndex
CREATE INDEX "prospect_import_rows_importId_validationStatus_idx" ON "prospect_import_rows"("importId", "validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "prospect_import_rows_importId_rowNumber_key" ON "prospect_import_rows"("importId", "rowNumber");

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
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "managed_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
