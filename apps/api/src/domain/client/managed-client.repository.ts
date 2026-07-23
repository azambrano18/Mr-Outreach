import {
  CreateManagedClientInput,
  ManagedClient,
  UpdateManagedClientInput,
} from './managed-client.entity';

export interface ManagedClientRepository {
  findById(id: string): Promise<ManagedClient | null>;
  findAll(organizationId: string): Promise<ManagedClient[]>;
  create(input: CreateManagedClientInput): Promise<ManagedClient>;
  update(id: string, input: UpdateManagedClientInput): Promise<ManagedClient>;
  findByCrmClientId(organizationId: string, crmClientId: number): Promise<ManagedClient | null>;
}
