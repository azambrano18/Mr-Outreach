import { Module } from '@nestjs/common';
import { SequenceContactsService } from '../../application/sequence-contacts/sequence-contacts.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationModule } from '../integration/integration.module';
import { SequenceImportsModule } from '../sequence-imports/sequence-imports.module';
import { SequencesModule } from '../sequences/sequences.module';
import { MeSequenceContactsController } from './me-sequence-contacts.controller';
import { SequenceContactsController } from './sequence-contacts.controller';

@Module({
  imports: [PersistenceModule, AuthModule, IntegrationModule, SequencesModule, SequenceImportsModule],
  controllers: [MeSequenceContactsController, SequenceContactsController],
  providers: [SequenceContactsService],
  exports: [SequenceContactsService],
})
export class SequenceContactsModule {}
