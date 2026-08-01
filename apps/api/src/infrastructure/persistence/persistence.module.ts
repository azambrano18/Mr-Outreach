import { Module, Provider } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import {
  AUDIT_LOG_REPOSITORY,
  CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
  COMPANY_REPOSITORY,
  CONTACT_REPOSITORY,
  CONVERSATION_MESSAGE_REPOSITORY,
  CONVERSATION_NOTE_REPOSITORY,
  CONVERSATION_READ_STATE_REPOSITORY,
  CONVERSATION_REPOSITORY,
  CONVERSATION_TAG_REPOSITORY,
  DOMAIN_REPOSITORY,
  EMAIL_BODY_ASSET_REPOSITORY,
  INTEGRATION_COMMAND_REPOSITORY,
  INTEGRATION_EVENT_REPOSITORY,
  MAILBOX_ASSIGNMENT_REPOSITORY,
  MAILBOX_CONNECTION_TEST_REPOSITORY,
  MAILBOX_REPOSITORY,
  MANAGED_CLIENT_REPOSITORY,
  ORGANIZATION_REPOSITORY,
  PERMISSION_REPOSITORY,
  PRISMA_SERVICE,
  PROSPECT_IMPORT_REPOSITORY,
  PROSPECT_IMPORT_ROW_REPOSITORY,
  ROLE_REPOSITORY,
  SCHEDULED_EMAIL_REPOSITORY,
  SEQUENCE_CONTACT_REPOSITORY,
  SEQUENCE_EXECUTION_REPOSITORY,
  SEQUENCE_IMPORT_REPOSITORY,
  SEQUENCE_IMPORT_ROW_REPOSITORY,
  SEQUENCE_REPOSITORY,
  SEQUENCE_STEP_REPOSITORY,
  SEQUENCE_STEP_VERSION_REPOSITORY,
  SEQUENCE_TEMPLATE_REPOSITORY,
  SEQUENCE_TEMPLATE_STEP_REPOSITORY,
  SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
  SIGNATURE_ASSET_REPOSITORY,
  SIGNATURE_REPOSITORY,
  SIGNATURE_VERSION_REPOSITORY,
  TEMPLATE_REPOSITORY,
  TRANSACTION_MANAGER,
  USER_REPOSITORY,
  USER_ROLE_REPOSITORY,
  VARIABLE_REPOSITORY,
} from './tokens';
import { PersistenceHealthIndicator } from './persistence-health.indicator';
import { MemoryStore } from './memory/memory-store';
import { InMemoryAuditLogRepository } from './memory/in-memory-audit-log.repository';
import { InMemoryMailboxAssignmentRepository } from './memory/in-memory-mailbox-assignment.repository';
import { InMemoryMailboxConnectionTestRepository } from './memory/in-memory-mailbox-connection-test.repository';
import { InMemoryMailboxRepository } from './memory/in-memory-mailbox.repository';
import { InMemoryOrganizationRepository } from './memory/in-memory-organization.repository';
import { InMemoryPermissionRepository } from './memory/in-memory-permission.repository';
import { InMemoryRoleRepository } from './memory/in-memory-role.repository';
import { InMemorySequenceStepVersionRepository } from './memory/in-memory-sequence-step-version.repository';
import { InMemorySequenceStepRepository } from './memory/in-memory-sequence-step.repository';
import { InMemorySequenceRepository } from './memory/in-memory-sequence.repository';
import { InMemorySignatureVersionRepository } from './memory/in-memory-signature-version.repository';
import { InMemorySignatureRepository } from './memory/in-memory-signature.repository';
import { InMemoryTemplateRepository } from './memory/in-memory-template.repository';
import { InMemoryManagedClientRepository } from './memory/in-memory-managed-client.repository';
import { InMemoryClientExecutiveAssignmentRepository } from './memory/in-memory-client-executive-assignment.repository';
import { InMemoryDomainRepository } from './memory/in-memory-domain.repository';
import { InMemoryConversationRepository } from './memory/in-memory-conversation.repository';
import { InMemoryConversationMessageRepository } from './memory/in-memory-conversation-message.repository';
import { InMemoryConversationTagRepository } from './memory/in-memory-conversation-tag.repository';
import { InMemoryConversationNoteRepository } from './memory/in-memory-conversation-note.repository';
import { InMemoryConversationReadStateRepository } from './memory/in-memory-conversation-read-state.repository';
import { PrismaConversationRepository } from './prisma/prisma-conversation.repository';
import { PrismaConversationMessageRepository } from './prisma/prisma-conversation-message.repository';
import { PrismaConversationTagRepository } from './prisma/prisma-conversation-tag.repository';
import { PrismaConversationNoteRepository } from './prisma/prisma-conversation-note.repository';
import { PrismaConversationReadStateRepository } from './prisma/prisma-conversation-read-state.repository';
import { InMemoryIntegrationCommandRepository } from './memory/in-memory-integration-command.repository';
import { InMemoryIntegrationEventRepository } from './memory/in-memory-integration-event.repository';
import { InMemoryCompanyRepository } from './memory/in-memory-company.repository';
import { InMemoryContactRepository } from './memory/in-memory-contact.repository';
import { InMemorySequenceImportRepository } from './memory/in-memory-sequence-import.repository';
import { InMemorySequenceImportRowRepository } from './memory/in-memory-sequence-import-row.repository';
import { InMemorySequenceContactRepository } from './memory/in-memory-sequence-contact.repository';
import { InMemoryScheduledEmailRepository } from './memory/in-memory-scheduled-email.repository';
import { InMemorySequenceTemplateRepository } from './memory/in-memory-sequence-template.repository';
import { InMemorySequenceTemplateStepRepository } from './memory/in-memory-sequence-template-step.repository';
import { InMemorySequenceTemplateVersionRepository } from './memory/in-memory-sequence-template-version.repository';
import { InMemorySequenceExecutionRepository } from './memory/in-memory-sequence-execution.repository';
import { InMemoryProspectImportRepository } from './memory/in-memory-prospect-import.repository';
import { InMemoryProspectImportRowRepository } from './memory/in-memory-prospect-import-row.repository';
import { InMemoryEmailBodyAssetRepository } from './memory/in-memory-email-body-asset.repository';
import { InMemorySignatureAssetRepository } from './memory/in-memory-signature-asset.repository';
import { InMemoryUserRepository } from './memory/in-memory-user.repository';
import { InMemoryUserRoleRepository } from './memory/in-memory-user-role.repository';
import { InMemoryVariableRepository } from './memory/in-memory-variable.repository';
import { PrismaService } from './prisma/prisma.service';
import { PrismaAuditLogRepository } from './prisma/prisma-audit-log.repository';
import { PrismaMailboxAssignmentRepository } from './prisma/prisma-mailbox-assignment.repository';
import { PrismaMailboxConnectionTestRepository } from './prisma/prisma-mailbox-connection-test.repository';
import { PrismaMailboxRepository } from './prisma/prisma-mailbox.repository';
import { PrismaOrganizationRepository } from './prisma/prisma-organization.repository';
import { PrismaPermissionRepository } from './prisma/prisma-permission.repository';
import { PrismaRoleRepository } from './prisma/prisma-role.repository';
import { PrismaSequenceStepVersionRepository } from './prisma/prisma-sequence-step-version.repository';
import { PrismaSequenceStepRepository } from './prisma/prisma-sequence-step.repository';
import { PrismaSequenceRepository } from './prisma/prisma-sequence.repository';
import { PrismaSignatureVersionRepository } from './prisma/prisma-signature-version.repository';
import { PrismaSignatureRepository } from './prisma/prisma-signature.repository';
import { PrismaTemplateRepository } from './prisma/prisma-template.repository';
import { PrismaUserRepository } from './prisma/prisma-user.repository';
import { PrismaUserRoleRepository } from './prisma/prisma-user-role.repository';
import { PrismaVariableRepository } from './prisma/prisma-variable.repository';
import { PrismaManagedClientRepository } from './prisma/prisma-managed-client.repository';
import { PrismaDomainRepository } from './prisma/prisma-domain.repository';
import { PrismaClientExecutiveAssignmentRepository } from './prisma/prisma-client-executive-assignment.repository';
import { PrismaIntegrationCommandRepository } from './prisma/prisma-integration-command.repository';
import { PrismaIntegrationEventRepository } from './prisma/prisma-integration-event.repository';
import { PrismaCompanyRepository } from './prisma/prisma-company.repository';
import { PrismaContactRepository } from './prisma/prisma-contact.repository';
import { PrismaSequenceImportRepository } from './prisma/prisma-sequence-import.repository';
import { PrismaSequenceImportRowRepository } from './prisma/prisma-sequence-import-row.repository';
import { PrismaSequenceContactRepository } from './prisma/prisma-sequence-contact.repository';
import { PrismaScheduledEmailRepository } from './prisma/prisma-scheduled-email.repository';
import { PrismaSequenceTemplateRepository } from './prisma/prisma-sequence-template.repository';
import { PrismaSequenceTemplateStepRepository } from './prisma/prisma-sequence-template-step.repository';
import { PrismaSequenceTemplateVersionRepository } from './prisma/prisma-sequence-template-version.repository';
import { PrismaSequenceExecutionRepository } from './prisma/prisma-sequence-execution.repository';
import { PrismaProspectImportRepository } from './prisma/prisma-prospect-import.repository';
import { PrismaProspectImportRowRepository } from './prisma/prisma-prospect-import-row.repository';
import { PrismaEmailBodyAssetRepository } from './prisma/prisma-email-body-asset.repository';
import { PrismaSignatureAssetRepository } from './prisma/prisma-signature-asset.repository';
import { PrismaTransactionManager } from './prisma/prisma-transaction-manager';
import { InMemoryTransactionManager } from './memory/in-memory-transaction-manager';

const prismaServiceProvider: Provider = {
  provide: PRISMA_SERVICE,
  useFactory: (config: AppConfigService): PrismaService | null =>
    config.persistenceDriver === 'postgres' ? new PrismaService() : null,
  inject: [AppConfigService],
};

/** Fase 2 — Unit of Work, same postgres/memory split as every repository below. */
const transactionManagerProvider: Provider = {
  provide: TRANSACTION_MANAGER,
  useFactory: (config: AppConfigService, prisma: PrismaService | null) =>
    config.persistenceDriver === 'postgres'
      ? new PrismaTransactionManager(prisma!)
      : new InMemoryTransactionManager(),
  inject: [AppConfigService, PRISMA_SERVICE],
};

/**
 * The one place that decides, per repository, whether the memory or the
 * Prisma adapter backs it. Every other module only ever injects the
 * repository *tokens* below and never knows which adapter is active.
 */
const repositoryProviders: Provider[] = [
  {
    provide: ORGANIZATION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaOrganizationRepository(prisma!)
        : new InMemoryOrganizationRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: USER_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaUserRepository(prisma!)
        : new InMemoryUserRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: ROLE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaRoleRepository(prisma!)
        : new InMemoryRoleRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: PERMISSION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaPermissionRepository(prisma!)
        : new InMemoryPermissionRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: USER_ROLE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaUserRoleRepository(prisma!)
        : new InMemoryUserRoleRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: AUDIT_LOG_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaAuditLogRepository(prisma!)
        : new InMemoryAuditLogRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: MAILBOX_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaMailboxRepository(prisma!)
        : new InMemoryMailboxRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: MAILBOX_CONNECTION_TEST_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaMailboxConnectionTestRepository(prisma!)
        : new InMemoryMailboxConnectionTestRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: MAILBOX_ASSIGNMENT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaMailboxAssignmentRepository(prisma!)
        : new InMemoryMailboxAssignmentRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: TEMPLATE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaTemplateRepository(prisma!)
        : new InMemoryTemplateRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: VARIABLE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaVariableRepository(prisma!)
        : new InMemoryVariableRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SIGNATURE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSignatureRepository(prisma!)
        : new InMemorySignatureRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SIGNATURE_VERSION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSignatureVersionRepository(prisma!)
        : new InMemorySignatureVersionRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceRepository(prisma!)
        : new InMemorySequenceRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_STEP_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceStepRepository(prisma!)
        : new InMemorySequenceStepRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_STEP_VERSION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceStepVersionRepository(prisma!)
        : new InMemorySequenceStepVersionRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  // AdminReorg Etapa 5 — ManagedClient/Domain/ClientExecutiveAssignment now
  // have real Prisma models/migration, closing the gap this comment used to
  // describe (they used to always resolve to the in-memory implementation
  // regardless of PERSISTENCE_DRIVER — no longer true).
  {
    provide: MANAGED_CLIENT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaManagedClientRepository(prisma!)
        : new InMemoryManagedClientRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaClientExecutiveAssignmentRepository(prisma!)
        : new InMemoryClientExecutiveAssignmentRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: DOMAIN_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaDomainRepository(prisma!)
        : new InMemoryDomainRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    // Fase "Conversaciones persistentes" — previously bound unconditionally
    // to the in-memory adapter regardless of PERSISTENCE_DRIVER; now
    // branches like every other repository in this module.
    provide: CONVERSATION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaConversationRepository(prisma!)
        : new InMemoryConversationRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: CONVERSATION_MESSAGE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaConversationMessageRepository(prisma!)
        : new InMemoryConversationMessageRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: CONVERSATION_TAG_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaConversationTagRepository(prisma!)
        : new InMemoryConversationTagRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: CONVERSATION_NOTE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaConversationNoteRepository(prisma!)
        : new InMemoryConversationNoteRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: CONVERSATION_READ_STATE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaConversationReadStateRepository(prisma!)
        : new InMemoryConversationReadStateRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  // Fase 1 — the simulated-engine integration layer (§54) and the
  // import/contact/company/scheduling model it drives now have real Prisma
  // adapters; PERSISTENCE_DRIVER selects between them the same way as
  // every other repository above.
  {
    provide: INTEGRATION_COMMAND_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaIntegrationCommandRepository(prisma!)
        : new InMemoryIntegrationCommandRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: INTEGRATION_EVENT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaIntegrationEventRepository(prisma!)
        : new InMemoryIntegrationEventRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: COMPANY_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaCompanyRepository(prisma!)
        : new InMemoryCompanyRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: CONTACT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaContactRepository(prisma!)
        : new InMemoryContactRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_IMPORT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceImportRepository(prisma!)
        : new InMemorySequenceImportRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_IMPORT_ROW_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceImportRowRepository(prisma!)
        : new InMemorySequenceImportRowRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_CONTACT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceContactRepository(prisma!)
        : new InMemorySequenceContactRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SCHEDULED_EMAIL_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaScheduledEmailRepository(prisma!)
        : new InMemoryScheduledEmailRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_TEMPLATE_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceTemplateRepository(prisma!)
        : new InMemorySequenceTemplateRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_TEMPLATE_STEP_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceTemplateStepRepository(prisma!)
        : new InMemorySequenceTemplateStepRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceTemplateVersionRepository(prisma!)
        : new InMemorySequenceTemplateVersionRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SEQUENCE_EXECUTION_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSequenceExecutionRepository(prisma!)
        : new InMemorySequenceExecutionRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: PROSPECT_IMPORT_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaProspectImportRepository(prisma!)
        : new InMemoryProspectImportRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: PROSPECT_IMPORT_ROW_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaProspectImportRowRepository(prisma!)
        : new InMemoryProspectImportRowRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: SIGNATURE_ASSET_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaSignatureAssetRepository(prisma!)
        : new InMemorySignatureAssetRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
  {
    provide: EMAIL_BODY_ASSET_REPOSITORY,
    useFactory: (config: AppConfigService, prisma: PrismaService | null, store: MemoryStore) =>
      config.persistenceDriver === 'postgres'
        ? new PrismaEmailBodyAssetRepository(prisma!)
        : new InMemoryEmailBodyAssetRepository(store),
    inject: [AppConfigService, PRISMA_SERVICE, MemoryStore],
  },
];

@Module({
  imports: [AppConfigModule],
  providers: [
    MemoryStore,
    prismaServiceProvider,
    transactionManagerProvider,
    PersistenceHealthIndicator,
    ...repositoryProviders,
  ],
  exports: [
    MemoryStore,
    TRANSACTION_MANAGER,
    ORGANIZATION_REPOSITORY,
    USER_REPOSITORY,
    ROLE_REPOSITORY,
    PERMISSION_REPOSITORY,
    USER_ROLE_REPOSITORY,
    AUDIT_LOG_REPOSITORY,
    MAILBOX_REPOSITORY,
    MAILBOX_CONNECTION_TEST_REPOSITORY,
    MAILBOX_ASSIGNMENT_REPOSITORY,
    TEMPLATE_REPOSITORY,
    VARIABLE_REPOSITORY,
    SIGNATURE_REPOSITORY,
    SIGNATURE_VERSION_REPOSITORY,
    SEQUENCE_REPOSITORY,
    SEQUENCE_STEP_REPOSITORY,
    SEQUENCE_STEP_VERSION_REPOSITORY,
    MANAGED_CLIENT_REPOSITORY,
    CLIENT_EXECUTIVE_ASSIGNMENT_REPOSITORY,
    DOMAIN_REPOSITORY,
    CONVERSATION_REPOSITORY,
    CONVERSATION_MESSAGE_REPOSITORY,
    CONVERSATION_TAG_REPOSITORY,
    CONVERSATION_NOTE_REPOSITORY,
    CONVERSATION_READ_STATE_REPOSITORY,
    INTEGRATION_COMMAND_REPOSITORY,
    INTEGRATION_EVENT_REPOSITORY,
    COMPANY_REPOSITORY,
    CONTACT_REPOSITORY,
    SEQUENCE_IMPORT_REPOSITORY,
    SEQUENCE_IMPORT_ROW_REPOSITORY,
    SEQUENCE_CONTACT_REPOSITORY,
    SCHEDULED_EMAIL_REPOSITORY,
    SEQUENCE_TEMPLATE_REPOSITORY,
    SEQUENCE_TEMPLATE_STEP_REPOSITORY,
    SEQUENCE_TEMPLATE_VERSION_REPOSITORY,
    SEQUENCE_EXECUTION_REPOSITORY,
    PROSPECT_IMPORT_REPOSITORY,
    PROSPECT_IMPORT_ROW_REPOSITORY,
    SIGNATURE_ASSET_REPOSITORY,
    EMAIL_BODY_ASSET_REPOSITORY,
    PersistenceHealthIndicator,
  ],
})
export class PersistenceModule {}
