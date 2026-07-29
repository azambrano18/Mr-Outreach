import { TransactionContext } from '../persistence/transaction';
import { CreateDomainInput, Domain, UpdateDomainInput } from './domain.entity';

export interface DomainRepository {
  findById(id: string, ctx?: TransactionContext): Promise<Domain | null>;
  findByClient(organizationId: string, clientId: string): Promise<Domain[]>;
  findByName(organizationId: string, domainName: string, ctx?: TransactionContext): Promise<Domain | null>;
  findAll(organizationId: string): Promise<Domain[]>;
  create(input: CreateDomainInput, ctx?: TransactionContext): Promise<Domain>;
  update(id: string, input: UpdateDomainInput, ctx?: TransactionContext): Promise<Domain>;
}
