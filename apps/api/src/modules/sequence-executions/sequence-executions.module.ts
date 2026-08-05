import { Module } from '@nestjs/common';
import { DevSimulatedExecutionStateService } from '../../application/sequence-executions/dev-simulated-execution-state.service';
import { ProspectIdentityResolver } from '../../application/prospect-imports/prospect-identity-resolver.service';
import { ProspectImportsService } from '../../application/prospect-imports/prospect-imports.service';
import { ControlSequenceExecutionUseCase } from '../../application/sequence-executions/control-sequence-execution.use-case';
import { RefreshExecutionStatusUseCase } from '../../application/sequence-executions/refresh-execution-status.use-case';
import { RestartSequenceExecutionUseCase } from '../../application/sequence-executions/restart-sequence-execution.use-case';
import { SequenceExecutionsService } from '../../application/sequence-executions/sequence-executions.service';
import { StartSequenceExecutionUseCase } from '../../application/sequence-executions/start-sequence-execution.use-case';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SecurityModule } from '../../infrastructure/security/security.module';
import { SequenceExecutionMotorModule } from '../../infrastructure/sequence-execution-motor/sequence-execution-motor.module';
import { AuthModule } from '../auth/auth.module';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MotorEventModule } from '../integration/motor-event.module';
import { SequenceTemplatesModule } from '../sequence-templates/sequence-templates.module';
import { AdminSequenceExecutionControlController } from './admin-sequence-execution-control.controller';
import { AdminSequenceExecutionsController } from './admin-sequence-executions.controller';
import { DevSimulatedExecutionsController } from './dev-simulated-executions.controller';
import { MeSequenceExecutionsController } from './me-sequence-executions.controller';

@Module({
  imports: [
    PersistenceModule,
    SecurityModule,
    AuthModule,
    MailboxesModule,
    SequenceTemplatesModule,
    SequenceExecutionMotorModule,
    MotorEventModule,
  ],
  controllers: [
    MeSequenceExecutionsController,
    AdminSequenceExecutionsController,
    AdminSequenceExecutionControlController,
    DevSimulatedExecutionsController,
  ],
  providers: [
    ProspectImportsService,
    ProspectIdentityResolver,
    SequenceExecutionsService,
    StartSequenceExecutionUseCase,
    RefreshExecutionStatusUseCase,
    ControlSequenceExecutionUseCase,
    RestartSequenceExecutionUseCase,
    DevSimulatedExecutionStateService,
  ],
  exports: [SequenceExecutionsService, ProspectImportsService],
})
export class SequenceExecutionsModule {}
