import { Module } from '@nestjs/common';
import { SequenceImportsService } from '../../application/sequence-imports/sequence-imports.service';
import { SchedulingService } from '../../application/scheduling/scheduling.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationModule } from '../integration/integration.module';
import { SequencesModule } from '../sequences/sequences.module';
import { MeSchedulingController } from './me-scheduling.controller';
import { MeSequenceImportsController } from './me-sequence-imports.controller';
import { SequenceImportsController } from './sequence-imports.controller';

@Module({
  imports: [PersistenceModule, AuthModule, IntegrationModule, SequencesModule],
  controllers: [MeSequenceImportsController, SequenceImportsController, MeSchedulingController],
  providers: [SequenceImportsService, SchedulingService],
  exports: [SequenceImportsService, SchedulingService],
})
export class SequenceImportsModule {}
