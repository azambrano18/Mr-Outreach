import { TransactionContext } from '../persistence/transaction';
import {
  CreateManagedClientInput,
  ManagedClient,
  UpdateManagedClientInput,
} from './managed-client.entity';

export interface ManagedClientRepository {
  findById(id: string, ctx?: TransactionContext): Promise<ManagedClient | null>;
  findAll(organizationId: string): Promise<ManagedClient[]>;
  create(input: CreateManagedClientInput, ctx?: TransactionContext): Promise<ManagedClient>;
  update(id: string, input: UpdateManagedClientInput, ctx?: TransactionContext): Promise<ManagedClient>;
  /** Dedupe/upsert key for SERVER-origin clients. */
  findByServerClientId(organizationId: string, serverClientId: string, ctx?: TransactionContext): Promise<ManagedClient | null>;
}
