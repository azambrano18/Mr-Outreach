import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../../../domain/persistence/transaction';
import {
  ClientExecutiveAssignment,
  CreateClientExecutiveAssignmentInput,
} from '../../../domain/client/client-executive-assignment.entity';
import { ClientExecutiveAssignmentRepository } from '../../../domain/client/client-executive-assignment.repository';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

@Injectable()
export class PrismaClientExecutiveAssignmentRepository implements ClientExecutiveAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: CreateClientExecutiveAssignmentInput, ctx?: TransactionContext): Promise<ClientExecutiveAssignment> {
    return resolveClient(this.prisma, ctx).clientExecutiveAssignment.upsert({
      where: { clientId_userId: { clientId: input.clientId, userId: input.userId } },
      create: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        userId: input.userId,
        role: input.role,
        visibilitySource: input.visibilitySource ?? 'MANUAL',
        assignedBy: input.assignedBy,
      },
      update: {
        role: input.role,
        visibilitySource: input.visibilitySource ?? 'MANUAL',
        assignedBy: input.assignedBy,
        assignedAt: new Date(),
      },
    });
  }

  async remove(clientId: string, userId: string, ctx?: TransactionContext): Promise<void> {
    await resolveClient(this.prisma, ctx)
      .clientExecutiveAssignment.delete({ where: { clientId_userId: { clientId, userId } } })
      .catch(() => undefined); // Already-removed is a no-op, matching the in-memory repository's behavior.
  }

  async findByClient(clientId: string): Promise<ClientExecutiveAssignment[]> {
    return this.prisma.clientExecutiveAssignment.findMany({ where: { clientId } });
  }

  async findByUser(userId: string, ctx?: TransactionContext): Promise<ClientExecutiveAssignment[]> {
    const client = resolveClient(this.prisma, ctx);
    return client.clientExecutiveAssignment.findMany({ where: { userId } });
  }

  async ensureDerivedVisibility(
    input: { organizationId: string; clientId: string; userId: string; assignedBy: string },
    ctx?: TransactionContext,
  ): Promise<void> {
    const client = resolveClient(this.prisma, ctx);
    const existing = await client.clientExecutiveAssignment.findUnique({
      where: { clientId_userId: { clientId: input.clientId, userId: input.userId } },
    });
    if (existing) {
      return; // Never touch an existing MANUAL or MAILBOX_DERIVED row.
    }
    await client.clientExecutiveAssignment
      .create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          userId: input.userId,
          role: 'SECONDARY',
          visibilitySource: 'MAILBOX_DERIVED',
          assignedBy: input.assignedBy,
        },
      })
      .catch(() => undefined); // Racing ensureDerivedVisibility calls: the loser's create() unique-violates, which is fine — the row already exists.
  }

  async removeDerivedVisibilityIfPresent(clientId: string, userId: string, ctx?: TransactionContext): Promise<void> {
    const client = resolveClient(this.prisma, ctx);
    const existing = await client.clientExecutiveAssignment.findUnique({
      where: { clientId_userId: { clientId, userId } },
    });
    if (existing && existing.visibilitySource === 'MAILBOX_DERIVED') {
      await client.clientExecutiveAssignment.delete({ where: { clientId_userId: { clientId, userId } } }).catch(() => undefined);
    }
  }
}
