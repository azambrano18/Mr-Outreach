import { Injectable } from '@nestjs/common';
import {
  ClientExecutiveAssignment,
  CreateClientExecutiveAssignmentInput,
} from '../../../domain/client/client-executive-assignment.entity';
import { ClientExecutiveAssignmentRepository } from '../../../domain/client/client-executive-assignment.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaClientExecutiveAssignmentRepository implements ClientExecutiveAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: CreateClientExecutiveAssignmentInput): Promise<ClientExecutiveAssignment> {
    return this.prisma.clientExecutiveAssignment.upsert({
      where: { clientId_userId: { clientId: input.clientId, userId: input.userId } },
      create: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        userId: input.userId,
        role: input.role,
        assignedBy: input.assignedBy,
      },
      update: {
        role: input.role,
        assignedBy: input.assignedBy,
        assignedAt: new Date(),
      },
    });
  }

  async remove(clientId: string, userId: string): Promise<void> {
    await this.prisma.clientExecutiveAssignment
      .delete({ where: { clientId_userId: { clientId, userId } } })
      .catch(() => undefined); // Already-removed is a no-op, matching the in-memory repository's behavior.
  }

  async findByClient(clientId: string): Promise<ClientExecutiveAssignment[]> {
    return this.prisma.clientExecutiveAssignment.findMany({ where: { clientId } });
  }

  async findByUser(userId: string): Promise<ClientExecutiveAssignment[]> {
    return this.prisma.clientExecutiveAssignment.findMany({ where: { userId } });
  }
}
