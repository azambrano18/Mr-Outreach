import { Module } from '@nestjs/common';
import { TemplatesService } from '../../application/templates/templates.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { TemplatesController } from './templates.controller';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
