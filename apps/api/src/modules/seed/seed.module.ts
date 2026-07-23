import { Module } from '@nestjs/common';
import { EngineModule } from '../../infrastructure/engine/engine.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { DevSeedService } from './dev-seed.service';

@Module({
  imports: [PersistenceModule, EngineModule],
  providers: [DevSeedService],
})
export class SeedModule {}
