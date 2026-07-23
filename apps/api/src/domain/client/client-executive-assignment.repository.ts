import {
  ClientExecutiveAssignment,
  CreateClientExecutiveAssignmentInput,
} from './client-executive-assignment.entity';

export interface ClientExecutiveAssignmentRepository {
  upsert(input: CreateClientExecutiveAssignmentInput): Promise<ClientExecutiveAssignment>;
  remove(clientId: string, userId: string): Promise<void>;
  findByClient(clientId: string): Promise<ClientExecutiveAssignment[]>;
  findByUser(userId: string): Promise<ClientExecutiveAssignment[]>;
}
