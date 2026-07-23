import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { HttpEngineClient } from './http/http-engine-client';
import { MockEngineClient } from './mock/mock-engine-client';
import { ENGINE_CLIENT } from './tokens';

/**
 * The mock instance is also exported under its own class token so the dev
 * seed / manual QA tooling can call setScenario()/clearScenarios() on it
 * directly when ENGINE_DRIVER=mock, without leaking that capability into
 * the EngineClient port (HttpEngineClient has no such method).
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    MockEngineClient,
    HttpEngineClient,
    {
      provide: ENGINE_CLIENT,
      useFactory: (config: AppConfigService, mock: MockEngineClient, http: HttpEngineClient) =>
        config.engineDriver === 'http' ? http : mock,
      inject: [AppConfigService, MockEngineClient, HttpEngineClient],
    },
  ],
  exports: [ENGINE_CLIENT, MockEngineClient],
})
export class EngineModule {}
