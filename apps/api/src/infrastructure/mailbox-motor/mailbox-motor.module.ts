import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { MAILBOX_MOTOR_PORT } from '../../domain/mailbox-motor/mailbox-motor-port';
import { HttpMailboxMotorAdapter } from './http/http-mailbox-motor-adapter';
import { SimulatedMailboxMotorAdapter } from './simulated/simulated-mailbox-motor-adapter';

/**
 * Fase 2.1 — mirrors `MailEngineModule`'s driver-switch shape exactly. The
 * simulated adapter is also exported under its own class token so tests
 * and the integration monitor's simulation controls can call
 * `issueLinkToken()`/`setMotorUnavailable()`/etc. directly, without leaking
 * simulation-only controls into the `MailboxMotorPort` contract itself.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    SimulatedMailboxMotorAdapter,
    HttpMailboxMotorAdapter,
    {
      provide: MAILBOX_MOTOR_PORT,
      useFactory: (config: AppConfigService, simulated: SimulatedMailboxMotorAdapter, http: HttpMailboxMotorAdapter) =>
        config.mailboxMotorDriver === 'http' ? http : simulated,
      inject: [AppConfigService, SimulatedMailboxMotorAdapter, HttpMailboxMotorAdapter],
    },
  ],
  exports: [MAILBOX_MOTOR_PORT, SimulatedMailboxMotorAdapter],
})
export class MailboxMotorModule {}
