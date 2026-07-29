import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { SEQUENCE_EXECUTION_MOTOR_PORT } from '../../domain/sequence-execution-motor/sequence-execution-motor-port';
import { HttpSequenceExecutionMotorAdapter } from './http/http-sequence-execution-motor-adapter';
import { SimulatedSequenceExecutionMotorAdapter } from './simulated/simulated-sequence-execution-motor-adapter';

/** Mirrors MailboxMotorModule/SequenceTemplateMotorModule's driver-switch shape exactly. */
@Module({
  imports: [AppConfigModule],
  providers: [
    SimulatedSequenceExecutionMotorAdapter,
    HttpSequenceExecutionMotorAdapter,
    {
      provide: SEQUENCE_EXECUTION_MOTOR_PORT,
      useFactory: (
        config: AppConfigService,
        simulated: SimulatedSequenceExecutionMotorAdapter,
        http: HttpSequenceExecutionMotorAdapter,
      ) => (config.sequenceMotorMode === 'http' ? http : simulated),
      inject: [AppConfigService, SimulatedSequenceExecutionMotorAdapter, HttpSequenceExecutionMotorAdapter],
    },
  ],
  exports: [SEQUENCE_EXECUTION_MOTOR_PORT, SimulatedSequenceExecutionMotorAdapter],
})
export class SequenceExecutionMotorModule {}
