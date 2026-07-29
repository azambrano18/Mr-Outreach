import { Module } from '@nestjs/common';
import { RemoveCompanyFromSequenceUseCase } from '../../application/sequence-contacts/remove-company-from-sequence.use-case';
import { RemoveContactFromSequenceUseCase } from '../../application/sequence-contacts/remove-contact-from-sequence.use-case';
import { SequenceContactsService } from '../../application/sequence-contacts/sequence-contacts.service';
import { IdempotencyModule } from '../../application/idempotency/idempotency.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationModule } from '../integration/integration.module';
import { SequenceImportsModule } from '../sequence-imports/sequence-imports.module';
import { SequencesModule } from '../sequences/sequences.module';
import { MeSequenceContactsController } from './me-sequence-contacts.controller';
import { SequenceContactsController } from './sequence-contacts.controller';

@Module({
  imports: [PersistenceModule, AuthModule, IntegrationModule, SequencesModule, SequenceImportsModule, IdempotencyModule],
  controllers: [MeSequenceContactsController, SequenceContactsController],
  providers: [SequenceContactsService, RemoveContactFromSequenceUseCase, RemoveCompanyFromSequenceUseCase],
  exports: [SequenceContactsService, RemoveContactFromSequenceUseCase, RemoveCompanyFromSequenceUseCase],
})
export class SequenceContactsModule {}
