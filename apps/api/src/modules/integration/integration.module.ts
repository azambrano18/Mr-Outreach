import { Module } from '@nestjs/common';
import { IntegrationService } from '../../application/integration/integration.service';
import { MailEngineModule } from '../../infrastructure/mail-engine/mail-engine.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';

/**
 * Owns the Outbox/Inbox mechanics (IntegrationService) shared by every
 * feature that submits commands to MailEnginePort — mailboxes, sequences,
 * imports, contacts/companies. Feature modules import this one instead of
 * each wiring MailEngineModule/IntegrationService themselves.
 */
@Module({
  imports: [PersistenceModule, MailEngineModule],
  providers: [IntegrationService],
  exports: [IntegrationService, MailEngineModule],
})
export class IntegrationModule {}
