import { Module } from '@nestjs/common';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PersistenceModule, EngineModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
