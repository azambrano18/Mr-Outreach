import { Injectable } from '@nestjs/common';
import { Role } from '../../../domain/role/role.entity';
import { UserRoleRepository } from '../../../domain/user-role/user-role.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryUserRoleRepository implements UserRoleRepository {
  constructor(private readonly store: MemoryStore) {}

  async assign(userId: string, roleId: string): Promise<void> {
    const roleIds = this.store.userRoles.get(userId) ?? new Set<string>();
    roleIds.add(roleId);
    this.store.userRoles.set(userId, roleIds);
  }

  async unassign(userId: string, roleId: string): Promise<void> {
    this.store.userRoles.get(userId)?.delete(roleId);
  }

  async getRolesForUser(userId: string): Promise<Role[]> {
    const roleIds = this.store.userRoles.get(userId) ?? new Set<string>();
    const roles: Role[] = [];
    for (const roleId of roleIds) {
      const role = this.store.roles.get(roleId);
      if (role) {
        roles.push(role);
      }
    }
    return roles;
  }
}
