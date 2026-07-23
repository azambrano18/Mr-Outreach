import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateRoleInput, Role } from '../../../domain/role/role.entity';
import { RoleRepository } from '../../../domain/role/role.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryRoleRepository implements RoleRepository {
  constructor(private readonly store: MemoryStore) {}

  async findById(id: string): Promise<Role | null> {
    return this.store.roles.get(id) ?? null;
  }

  async findByName(organizationId: string, name: string): Promise<Role | null> {
    for (const role of this.store.roles.values()) {
      if (role.organizationId === organizationId && role.name === name) {
        return role;
      }
    }
    return null;
  }

  async findAll(organizationId: string): Promise<Role[]> {
    return Array.from(this.store.roles.values()).filter(
      (role) => role.organizationId === organizationId,
    );
  }

  async create(input: CreateRoleInput): Promise<Role> {
    const existing = await this.findByName(input.organizationId, input.name);
    if (existing) {
      throw new ConflictException('A role with this name already exists in the organization.');
    }

    const now = new Date();
    const role: Role = {
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    };
    this.store.roles.set(role.id, role);
    this.store.rolePermissions.set(role.id, new Set(input.permissionKeys));
    return role;
  }

  async setPermissions(roleId: string, permissionKeys: string[]): Promise<void> {
    this.store.rolePermissions.set(roleId, new Set(permissionKeys));
  }

  async getPermissionKeys(roleId: string): Promise<string[]> {
    return Array.from(this.store.rolePermissions.get(roleId) ?? []);
  }
}
