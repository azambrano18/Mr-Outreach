import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './roles.controller';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [RolesController],
})
export class RolesModule {}
