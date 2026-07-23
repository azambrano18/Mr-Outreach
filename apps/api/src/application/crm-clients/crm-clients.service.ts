import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CrmClient } from '../../domain/crm-client/crm-client.entity';
import { CrmClientRepository } from '../../domain/crm-client/crm-client.repository';
import { CRM_CLIENT_REPOSITORY } from '../../infrastructure/persistence/tokens';

@Injectable()
export class CrmClientsService {
  constructor(@Inject(CRM_CLIENT_REPOSITORY) private readonly crmClients: CrmClientRepository) {}

  list(search?: string): Promise<CrmClient[]> {
    return this.crmClients.findAllActive({ search });
  }

  async getById(crmClientId: number): Promise<CrmClient> {
    const client = await this.crmClients.findById(crmClientId);
    if (!client) {
      throw new NotFoundException('CRM client not found.');
    }
    return client;
  }
}
