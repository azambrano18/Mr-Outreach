import { Inject, Injectable } from '@nestjs/common';
import { EngineClient } from '../../domain/engine/engine-client';
import { ENGINE_CLIENT } from '../../infrastructure/engine/tokens';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { PersistenceHealthIndicator } from '../../infrastructure/persistence/persistence-health.indicator';

export interface LivenessResult {
  status: 'ok';
  service: 'api';
}

export interface ReadinessResult {
  status: 'ok' | 'error';
  mode: 'development' | 'integrated';
  persistence: { driver: string; status: string };
  engine: { driver: string; status: string };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly config: AppConfigService,
    private readonly persistenceHealth: PersistenceHealthIndicator,
    @Inject(ENGINE_CLIENT) private readonly engineClient: EngineClient,
  ) {}

  live(): LivenessResult {
    // Deliberately checks nothing external: liveness only answers "is the
    // process up," which must stay true even before DATABASE_URL or
    // ENGINE_BASE_URL are configured.
    return { status: 'ok', service: 'api' };
  }

  async ready(): Promise<ReadinessResult> {
    const persistenceStatus = await this.persistenceHealth.checkStatus();
    const engineStatus = await this.engineClient.checkHealth();
    const isHealthy = persistenceStatus !== 'unavailable' && engineStatus !== 'unavailable';

    return {
      status: isHealthy ? 'ok' : 'error',
      mode: this.config.isIntegratedMode ? 'integrated' : 'development',
      persistence: { driver: this.config.persistenceDriver, status: persistenceStatus },
      engine: { driver: this.config.engineDriver, status: engineStatus },
    };
  }
}
