import { Module } from '@nestjs/common';
import { AdminSequenceMonitorService } from '../../application/sequences/admin-sequence-monitor.service';
import { SequencePublishService } from '../../application/sequences/sequence-publish.service';
import { SequenceStepsService } from '../../application/sequences/sequence-steps.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import { SchedulingService } from '../../application/scheduling/scheduling.service';
import { AppConfigModule } from '../../infrastructure/config/app-config.module';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { MailEngineModule } from '../../infrastructure/mail-engine/mail-engine.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { IntegrationModule } from '../integration/integration.module';
import { MeSequenceStepsController } from './me-sequence-steps.controller';
import { MeSequencesController } from './me-sequences.controller';
import { SequenceStepsController } from './sequence-steps.controller';
import { SequencesController } from './sequences.controller';

@Module({
  imports: [
    PersistenceModule,
    SecurityModule,
    EngineModule,
    AuthModule,
    IntegrationModule,
    AppConfigModule,
    MailEngineModule,
    ClientsModule,
  ],
  controllers: [
    SequencesController,
    SequenceStepsController,
    MeSequencesController,
    MeSequenceStepsController,
  ],
  providers: [
    SequencesService,
    SequenceStepsService,
    SequencePublishService,
    AdminSequenceMonitorService,
    SchedulingService,
  ],
  exports: [SequencesService, SequencePublishService, AdminSequenceMonitorService, SchedulingService],
})
export class SequencesModule {}
