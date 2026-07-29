import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { IdempotentOperationService } from './idempotent-operation.service';

/** Fase 2 — shared by every transactional use case; see idempotent-operation.service.ts. */
@Module({
  imports: [PersistenceModule],
  providers: [IdempotentOperationService],
  exports: [IdempotentOperationService],
})
export class IdempotencyModule {}
