import { Module } from '@nestjs/common';
import { ConfirmProspectImportUseCase } from '../../application/sequence-imports/confirm-prospect-import.use-case';
import { SequenceImportsService } from '../../application/sequence-imports/sequence-imports.service';
import { SchedulingService } from '../../application/scheduling/scheduling.service';
import { IdempotencyModule } from '../../application/idempotency/idempotency.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { CrmClientsModule } from '../crm-clients/crm-clients.module';
import { IntegrationModule } from '../integration/integration.module';
import { SequencesModule } from '../sequences/sequences.module';
import { MeSchedulingController } from './me-scheduling.controller';
import { MeSequenceImportsController } from './me-sequence-imports.controller';
import { SequenceImportsController } from './sequence-imports.controller';

@Module({
  imports: [PersistenceModule, AuthModule, IntegrationModule, SequencesModule, CrmClientsModule, IdempotencyModule],
  controllers: [MeSequenceImportsController, SequenceImportsController, MeSchedulingController],
  providers: [SequenceImportsService, SchedulingService, ConfirmProspectImportUseCase],
  exports: [SequenceImportsService, SchedulingService, ConfirmProspectImportUseCase],
})
export class SequenceImportsModule {}
