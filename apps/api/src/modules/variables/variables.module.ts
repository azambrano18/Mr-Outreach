import { Module } from '@nestjs/common';
import { VariablesService } from '../../application/variables/variables.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { VariablesController } from './variables.controller';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [VariablesController],
  providers: [VariablesService],
})
export class VariablesModule {}
