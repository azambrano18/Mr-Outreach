import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [AuditController],
})
export class AuditModule {}
