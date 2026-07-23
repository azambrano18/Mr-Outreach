import { CreateDomainInput, Domain, UpdateDomainInput } from './domain.entity';

export interface DomainRepository {
  findById(id: string): Promise<Domain | null>;
  findByClient(organizationId: string, clientId: string): Promise<Domain[]>;
  findByName(organizationId: string, domainName: string): Promise<Domain | null>;
  findAll(organizationId: string): Promise<Domain[]>;
  create(input: CreateDomainInput): Promise<Domain>;
  update(id: string, input: UpdateDomainInput): Promise<Domain>;
}
