import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClientMailboxVisibilityService } from '../../application/mailboxes/client-mailbox-visibility.service';
import { DeleteMailboxUseCase } from '../../application/mailboxes/delete-mailbox.use-case';
import { LinkMailboxUseCase } from '../../application/mailboxes/link-mailbox.use-case';
import { MailboxExecutiveAssignmentValidator } from '../../application/mailboxes/mailbox-executive-assignment.validator';
import { MailboxProvisioningEventApplier } from '../../application/mailboxes/mailbox-provisioning-event-applier';
import { MailboxProvisioningService } from '../../application/mailboxes/mailbox-provisioning.service';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import { PreviewMailboxUnlinkUseCase } from '../../application/mailboxes/preview-mailbox-unlink.use-case';
import { ReassignMailboxPrimaryExecutiveUseCase } from '../../application/mailboxes/reassign-mailbox-primary-executive.use-case';
import { RemoveMailboxAssignmentsAfterUnlinkUseCase } from '../../application/mailboxes/remove-mailbox-assignments-after-unlink.use-case';
import { RetryMailboxAssetCleanupUseCase } from '../../application/mailboxes/retry-mailbox-asset-cleanup.use-case';
import { UnlinkMailboxUseCase } from '../../application/mailboxes/unlink-mailbox.use-case';
import { UpdateMailboxConfigurationUseCase } from '../../application/mailboxes/update-mailbox-configuration.use-case';
import { IdempotencyModule } from '../../application/idempotency/idempotency.module';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { MailboxMotorModule } from '../../infrastructure/mailbox-motor/mailbox-motor.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { SignatureAssetStorageModule } from '../../infrastructure/signature-asset-storage/signature-asset-storage.module';
import { AuthModule } from '../auth/auth.module';
import { ClientEligibilityModule } from '../clients/client-eligibility.module';
import { ClientsModule } from '../clients/clients.module';
import { IntegrationModule } from '../integration/integration.module';
import { DevMailboxTokensController } from './dev-mailbox-tokens.controller';
import { MailboxHierarchyController } from './mailbox-hierarchy.controller';
import { MailboxesController } from './mailboxes.controller';
import { MeController } from './me.controller';

@Module({
  imports: [
    PersistenceModule,
    SecurityModule,
    EngineModule,
    AuthModule,
    IntegrationModule,
    ClientsModule,
    ClientEligibilityModule,
    IdempotencyModule,
    MailboxMotorModule,
    SignatureAssetStorageModule,
    // Fase 2.1 §17 — only link-token/introspect uses @UseGuards(ThrottlerGuard); every
    // other route here is unaffected since ThrottlerGuard is never registered as a global APP_GUARD.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [MailboxesController, MeController, MailboxHierarchyController, DevMailboxTokensController],
  providers: [
    MailboxesService,
    MailboxProvisioningService,
    UpdateMailboxConfigurationUseCase,
    MailboxExecutiveAssignmentValidator,
    MailboxProvisioningEventApplier,
    ClientMailboxVisibilityService,
    LinkMailboxUseCase,
    ReassignMailboxPrimaryExecutiveUseCase,
    UnlinkMailboxUseCase,
    PreviewMailboxUnlinkUseCase,
    RemoveMailboxAssignmentsAfterUnlinkUseCase,
    DeleteMailboxUseCase,
    RetryMailboxAssetCleanupUseCase,
  ],
  exports: [
    MailboxesService,
    MailboxProvisioningService,
    UpdateMailboxConfigurationUseCase,
    MailboxExecutiveAssignmentValidator,
    MailboxProvisioningEventApplier,
    ClientMailboxVisibilityService,
    LinkMailboxUseCase,
    ReassignMailboxPrimaryExecutiveUseCase,
    UnlinkMailboxUseCase,
    PreviewMailboxUnlinkUseCase,
    RemoveMailboxAssignmentsAfterUnlinkUseCase,
    DeleteMailboxUseCase,
    RetryMailboxAssetCleanupUseCase,
  ],
})
export class MailboxesModule {}
