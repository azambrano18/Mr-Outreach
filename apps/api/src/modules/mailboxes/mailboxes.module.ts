import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClientMailboxVisibilityService } from '../../application/mailboxes/client-mailbox-visibility.service';
import { ConfigureMailboxUseCase } from '../../application/mailboxes/configure-mailbox.use-case';
import { LinkMailboxUseCase } from '../../application/mailboxes/link-mailbox.use-case';
import { MailboxExecutiveAssignmentValidator } from '../../application/mailboxes/mailbox-executive-assignment.validator';
import { MailboxProvisioningEventApplier } from '../../application/mailboxes/mailbox-provisioning-event-applier';
import { MailboxProvisioningService } from '../../application/mailboxes/mailbox-provisioning.service';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import { ReassignMailboxPrimaryExecutiveUseCase } from '../../application/mailboxes/reassign-mailbox-primary-executive.use-case';
import { UnlinkMailboxUseCase } from '../../application/mailboxes/unlink-mailbox.use-case';
import { UpdateMailboxConfigurationUseCase } from '../../application/mailboxes/update-mailbox-configuration.use-case';
import { IdempotencyModule } from '../../application/idempotency/idempotency.module';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { MailboxMotorModule } from '../../infrastructure/mailbox-motor/mailbox-motor.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { CrmClientsModule } from '../crm-clients/crm-clients.module';
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
    CrmClientsModule,
    IdempotencyModule,
    MailboxMotorModule,
    // Fase 2.1 §17 — only link-token/introspect uses @UseGuards(ThrottlerGuard); every
    // other route here is unaffected since ThrottlerGuard is never registered as a global APP_GUARD.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [MailboxesController, MeController, MailboxHierarchyController, DevMailboxTokensController],
  providers: [
    MailboxesService,
    MailboxProvisioningService,
    ConfigureMailboxUseCase,
    UpdateMailboxConfigurationUseCase,
    MailboxExecutiveAssignmentValidator,
    MailboxProvisioningEventApplier,
    ClientMailboxVisibilityService,
    LinkMailboxUseCase,
    ReassignMailboxPrimaryExecutiveUseCase,
    UnlinkMailboxUseCase,
  ],
  exports: [
    MailboxesService,
    MailboxProvisioningService,
    ConfigureMailboxUseCase,
    UpdateMailboxConfigurationUseCase,
    MailboxExecutiveAssignmentValidator,
    MailboxProvisioningEventApplier,
    ClientMailboxVisibilityService,
    LinkMailboxUseCase,
    ReassignMailboxPrimaryExecutiveUseCase,
    UnlinkMailboxUseCase,
  ],
})
export class MailboxesModule {}
