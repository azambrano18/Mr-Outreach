import { Injectable } from '@nestjs/common';
import {
  CreateMailboxAssignmentInput,
  MailboxAssignment,
  MailboxAssignmentRole,
} from '../../../domain/mailbox-assignment/mailbox-assignment.entity';
import { MailboxAssignmentRepository } from '../../../domain/mailbox-assignment/mailbox-assignment.repository';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

@Injectable()
export class PrismaMailboxAssignmentRepository implements MailboxAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: CreateMailboxAssignmentInput, ctx?: TransactionContext): Promise<MailboxAssignment> {
    const row = await resolveClient(this.prisma, ctx).mailboxAssignment.upsert({
      where: { mailboxId_userId: { mailboxId: input.mailboxId, userId: input.userId } },
      create: {
        organizationId: input.organizationId,
        mailboxId: input.mailboxId,
        userId: input.userId,
        role: input.role,
        assignedBy: input.assignedBy,
      },
      update: { role: input.role, assignedBy: input.assignedBy, assignedAt: new Date() },
    });
    return this.toDomain(row);
  }

  async remove(mailboxId: string, userId: string, ctx?: TransactionContext): Promise<void> {
    await resolveClient(this.prisma, ctx).mailboxAssignment.deleteMany({ where: { mailboxId, userId } });
  }

  async findByMailbox(mailboxId: string, ctx?: TransactionContext): Promise<MailboxAssignment[]> {
    const rows = await resolveClient(this.prisma, ctx).mailboxAssignment.findMany({ where: { mailboxId } });
    return rows.map((row) => this.toDomain(row));
  }

  async findByUser(userId: string, ctx?: TransactionContext): Promise<MailboxAssignment[]> {
    const rows = await resolveClient(this.prisma, ctx).mailboxAssignment.findMany({ where: { userId } });
    return rows.map((row) => this.toDomain(row));
  }

  async findAllByOrganization(organizationId: string): Promise<MailboxAssignment[]> {
    const rows = await this.prisma.mailboxAssignment.findMany({ where: { organizationId } });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: {
    id: string;
    organizationId: string;
    mailboxId: string;
    userId: string;
    role: string;
    assignedBy: string;
    assignedAt: Date;
  }): MailboxAssignment {
    return {
      id: row.id,
      organizationId: row.organizationId,
      mailboxId: row.mailboxId,
      userId: row.userId,
      role: row.role as MailboxAssignmentRole,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
    };
  }
}
