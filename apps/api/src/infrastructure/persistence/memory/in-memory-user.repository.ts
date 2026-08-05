import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateUserInput, UpdateUserInput, User } from '../../../domain/user/user.entity';
import { UserRepository } from '../../../domain/user/user.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<User | null> {
    const user = this.store.users.get(id);
    return user && !user.deletedAt ? user : null;
  }

  async findByEmail(organizationId: string, email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const user of this.store.users.values()) {
      if (
        !user.deletedAt &&
        user.organizationId === organizationId &&
        user.email.toLowerCase() === normalized
      ) {
        return user;
      }
    }
    return null;
  }

  async findByEmailAnyOrganization(email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const user of this.store.users.values()) {
      if (!user.deletedAt && user.email.toLowerCase() === normalized) {
        return user;
      }
    }
    return null;
  }

  async findByEmailIncludingDeleted(organizationId: string, email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const user of this.store.users.values()) {
      if (user.organizationId === organizationId && user.email.toLowerCase() === normalized) {
        return user;
      }
    }
    return null;
  }

  async findAll(organizationId: string): Promise<User[]> {
    return Array.from(this.store.users.values()).filter(
      (user) => !user.deletedAt && user.organizationId === organizationId,
    );
  }

  async create(input: CreateUserInput): Promise<User> {
    const existing = await this.findByEmail(input.organizationId, input.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists in the organization.');
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      organizationId: input.organizationId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash: input.passwordHash,
      status: input.status ?? 'ACTIVE',
      mustChangePassword: input.mustChangePassword ?? false,
      lastLoginAt: null,
      passwordChangedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.store.users.set(user.id, user);
    return user;
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const existing = this.store.users.get(id);
    // A soft-deleted user can only ever be updated to explicitly clear
    // `deletedAt` (the restore flow) — any other update attempt against a
    // deleted row is still refused, matching PrismaUserRepository (which
    // has no such guard at all, since a real UPDATE by primary key doesn't
    // care about deletedAt) while keeping this driver's stricter default.
    if (!existing || (existing.deletedAt && input.deletedAt !== null)) {
      throw new ConflictException('User not found.');
    }

    const updated: User = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    this.store.users.set(id, updated);
    return updated;
  }
}
