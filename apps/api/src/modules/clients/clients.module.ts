import { Module } from '@nestjs/common';
import { AdminClientsService } from '../../application/admin-clients/admin-clients.service';
import { ClientsService } from '../../application/clients/clients.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { CrmClientsModule } from '../crm-clients/crm-clients.module';
import { ClientsController } from './clients.controller';
import { MeClientsController } from './me-clients.controller';

@Module({
  imports: [PersistenceModule, AuthModule, CrmClientsModule],
  controllers: [ClientsController, MeClientsController],
  providers: [ClientsService, AdminClientsService],
  exports: [ClientsService, AdminClientsService],
})
export class ClientsModule {}
