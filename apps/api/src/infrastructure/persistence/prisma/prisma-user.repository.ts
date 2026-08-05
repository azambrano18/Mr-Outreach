import { ConflictException, Injectable } from '@nestjs/common';
import { TransactionContext } from '../../../domain/persistence/transaction';
import { CreateUserInput, UpdateUserInput, User } from '../../../domain/user/user.entity';
import { UserRepository } from '../../../domain/user/user.repository';
import { PrismaService } from './prisma.service';
import { resolveClient } from './prisma-transaction-manager';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, ctx?: TransactionContext): Promise<User | null> {
    const client = resolveClient(this.prisma, ctx);
    return client.user.findFirst({ where: { id, deletedAt: null } });
  }

  async findByEmail(organizationId: string, email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { organizationId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
  }

  async findByEmailAnyOrganization(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    });
  }

  async findByEmailIncludingDeleted(organizationId: string, email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { organizationId, email: { equals: email, mode: 'insensitive' } },
    });
  }

  async findAll(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({ where: { organizationId, deletedAt: null } });
  }

  async create(input: CreateUserInput): Promise<User> {
    const existing = await this.findByEmail(input.organizationId, input.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists in the organization.');
    }

    return this.prisma.user.create({
      data: {
        organizationId: input.organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash: input.passwordHash,
        status: input.status ?? 'ACTIVE',
        mustChangePassword: input.mustChangePassword ?? false,
      },
    });
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: input });
  }
}
