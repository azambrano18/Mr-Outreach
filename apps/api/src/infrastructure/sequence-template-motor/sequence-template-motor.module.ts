import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { SEQUENCE_TEMPLATE_MOTOR_PORT } from '../../domain/sequence-template-motor/sequence-template-motor-port';
import { HttpSequenceTemplateMotorAdapter } from './http/http-sequence-template-motor-adapter';
import { SimulatedSequenceTemplateMotorAdapter } from './simulated/simulated-sequence-template-motor-adapter';

/** Mirrors MailboxMotorModule's driver-switch shape exactly. */
@Module({
  imports: [AppConfigModule],
  providers: [
    SimulatedSequenceTemplateMotorAdapter,
    HttpSequenceTemplateMotorAdapter,
    {
      provide: SEQUENCE_TEMPLATE_MOTOR_PORT,
      useFactory: (
        config: AppConfigService,
        simulated: SimulatedSequenceTemplateMotorAdapter,
        http: HttpSequenceTemplateMotorAdapter,
      ) => (config.sequenceMotorMode === 'http' ? http : simulated),
      inject: [AppConfigService, SimulatedSequenceTemplateMotorAdapter, HttpSequenceTemplateMotorAdapter],
    },
  ],
  exports: [SEQUENCE_TEMPLATE_MOTOR_PORT, SimulatedSequenceTemplateMotorAdapter],
})
export class SequenceTemplateMotorModule {}
