import { Module } from '@nestjs/common';
import { MailboxProvisioningService } from '../../application/mailboxes/mailbox-provisioning.service';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { IntegrationModule } from '../integration/integration.module';
import { MailboxHierarchyController } from './mailbox-hierarchy.controller';
import { MailboxesController } from './mailboxes.controller';
import { MeController } from './me.controller';

@Module({
  imports: [PersistenceModule, SecurityModule, EngineModule, AuthModule, IntegrationModule, ClientsModule],
  controllers: [MailboxesController, MeController, MailboxHierarchyController],
  providers: [MailboxesService, MailboxProvisioningService],
  exports: [MailboxesService, MailboxProvisioningService],
})
export class MailboxesModule {}
