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
  findByCrmClientId(organizationId: string, crmClientId: number, ctx?: TransactionContext): Promise<ManagedClient | null>;
  /** Fase 2.1 — dedupe/upsert key for SERVER-origin clients (no crmClientId). */
  findByServerClientId(organizationId: string, serverClientId: string, ctx?: TransactionContext): Promise<ManagedClient | null>;
}
