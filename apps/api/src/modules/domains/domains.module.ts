import { Module } from '@nestjs/common';
import { DomainsService } from '../../application/domains/domains.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsModule } from '../clients/clients.module';
import { DomainsController } from './domains.controller';
import { MeDomainsController } from './me-domains.controller';

@Module({
  imports: [PersistenceModule, AuthModule, ClientsModule],
  controllers: [DomainsController, MeDomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
