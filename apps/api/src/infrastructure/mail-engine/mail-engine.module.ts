import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { MAIL_ENGINE_PORT } from '../../domain/integration/mail-engine-port';
import { RemoteMailEngineAdapter } from './remote/remote-mail-engine-adapter';
import { SimulatedMailEngineAdapter } from './simulated/simulated-mail-engine-adapter';

/**
 * Mirrors EngineModule's driver-switch shape (engine/engine.module.ts) —
 * same reasoning applies here: the simulated adapter is also exported
 * under its own class token so IntegrationService and dev/QA tooling can
 * call planEvents()/setMailboxScenario()/setImportScenario() directly when
 * MAIL_ENGINE_MODE=simulation, without leaking simulation-only controls
 * into the MailEnginePort contract itself.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    SimulatedMailEngineAdapter,
    RemoteMailEngineAdapter,
    {
      provide: MAIL_ENGINE_PORT,
      useFactory: (
        config: AppConfigService,
        simulated: SimulatedMailEngineAdapter,
        remote: RemoteMailEngineAdapter,
      ) => (config.mailEngineMode === 'remote' ? remote : simulated),
      inject: [AppConfigService, SimulatedMailEngineAdapter, RemoteMailEngineAdapter],
    },
  ],
  exports: [MAIL_ENGINE_PORT, SimulatedMailEngineAdapter],
})
export class MailEngineModule {}
