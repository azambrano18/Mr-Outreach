import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateMailboxAssignmentInput,
  MailboxAssignment,
} from '../../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../../domain/mailbox-assignment/mailbox-assignment.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryMailboxAssignmentRepository implements MailboxAssignmentRepository {
  constructor(private readonly store: MemoryStore) {}

  async upsert(input: CreateMailboxAssignmentInput): Promise<MailboxAssignment> {
    const existing = this.store.mailboxAssignments.find(
      (a) => a.mailboxId === input.mailboxId && a.userId === input.userId,
    );

    if (existing) {
      existing.role = input.role;
      existing.assignedBy = input.assignedBy;
      existing.assignedAt = new Date();
      return existing;
    }

    const assignment: MailboxAssignment = {
      id: randomUUID(),
      organizationId: input.organizationId,
      mailboxId: input.mailboxId,
      userId: input.userId,
      role: input.role,
      assignedBy: input.assignedBy,
      assignedAt: new Date(),
    };
    this.store.mailboxAssignments.push(assignment);
    return assignment;
  }

  async remove(mailboxId: string, userId: string): Promise<void> {
    const index = this.store.mailboxAssignments.findIndex(
      (a) => a.mailboxId === mailboxId && a.userId === userId,
    );
    if (index !== -1) {
      this.store.mailboxAssignments.splice(index, 1);
    }
  }

  async findByMailbox(mailboxId: string): Promise<MailboxAssignment[]> {
    return this.store.mailboxAssignments.filter((a) => a.mailboxId === mailboxId);
  }

  async findByUser(userId: string): Promise<MailboxAssignment[]> {
    return this.store.mailboxAssignments.filter((a) => a.userId === userId);
  }

  async findAllByOrganization(organizationId: string): Promise<MailboxAssignment[]> {
    return this.store.mailboxAssignments.filter((a) => a.organizationId === organizationId);
  }
}
