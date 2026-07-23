import { Module } from '@nestjs/common';
import { CrmClientEligibilityService } from '../../application/crm-clients/crm-client-eligibility.service';
import { CrmClientsService } from '../../application/crm-clients/crm-clients.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { CrmClientsController } from './crm-clients.controller';

@Module({
  imports: [PersistenceModule, AuthModule],
  controllers: [CrmClientsController],
  providers: [CrmClientsService, CrmClientEligibilityService],
  exports: [CrmClientsService, CrmClientEligibilityService],
})
export class CrmClientsModule {}
