import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ClientExecutiveAssignment,
  CreateClientExecutiveAssignmentInput,
} from '../../../domain/client/client-executive-assignment.entity';
import { ClientExecutiveAssignmentRepository } from '../../../domain/client/client-executive-assignment.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryClientExecutiveAssignmentRepository implements ClientExecutiveAssignmentRepository {
  constructor(private readonly store: MemoryStore) {}

  async upsert(input: CreateClientExecutiveAssignmentInput): Promise<ClientExecutiveAssignment> {
    const existing = this.store.clientExecutiveAssignments.find(
      (a) => a.clientId === input.clientId && a.userId === input.userId,
    );

    if (existing) {
      existing.role = input.role;
      existing.visibilitySource = input.visibilitySource ?? 'MANUAL';
      existing.assignedBy = input.assignedBy;
      existing.assignedAt = new Date();
      return existing;
    }

    const assignment: ClientExecutiveAssignment = {
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      userId: input.userId,
      role: input.role,
      visibilitySource: input.visibilitySource ?? 'MANUAL',
      assignedBy: input.assignedBy,
      assignedAt: new Date(),
    };
    this.store.clientExecutiveAssignments.push(assignment);
    return assignment;
  }

  async remove(clientId: string, userId: string): Promise<void> {
    const index = this.store.clientExecutiveAssignments.findIndex(
      (a) => a.clientId === clientId && a.userId === userId,
    );
    if (index !== -1) {
      this.store.clientExecutiveAssignments.splice(index, 1);
    }
  }

  async findByClient(clientId: string): Promise<ClientExecutiveAssignment[]> {
    return this.store.clientExecutiveAssignments.filter((a) => a.clientId === clientId);
  }

  async findByUser(userId: string): Promise<ClientExecutiveAssignment[]> {
    return this.store.clientExecutiveAssignments.filter((a) => a.userId === userId);
  }

  async ensureDerivedVisibility(input: {
    organizationId: string;
    clientId: string;
    userId: string;
    assignedBy: string;
  }): Promise<void> {
    const existing = this.store.clientExecutiveAssignments.find(
      (a) => a.clientId === input.clientId && a.userId === input.userId,
    );
    if (existing) {
      return;
    }
    this.store.clientExecutiveAssignments.push({
      id: randomUUID(),
      organizationId: input.organizationId,
      clientId: input.clientId,
      userId: input.userId,
      role: 'SECONDARY',
      visibilitySource: 'MAILBOX_DERIVED',
      assignedBy: input.assignedBy,
      assignedAt: new Date(),
    });
  }

  async removeDerivedVisibilityIfPresent(clientId: string, userId: string): Promise<void> {
    const index = this.store.clientExecutiveAssignments.findIndex(
      (a) => a.clientId === clientId && a.userId === userId && a.visibilitySource === 'MAILBOX_DERIVED',
    );
    if (index !== -1) {
      this.store.clientExecutiveAssignments.splice(index, 1);
    }
  }
}
