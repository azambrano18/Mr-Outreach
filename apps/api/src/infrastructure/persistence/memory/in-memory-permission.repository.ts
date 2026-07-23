import { Injectable } from '@nestjs/common';
import { Permission } from '../../../domain/permission/permission.entity';
import { PermissionRepository } from '../../../domain/permission/permission.repository';
import { MemoryStore } from './memory-store';

@Injectable()
export class InMemoryPermissionRepository implements PermissionRepository {
  constructor(private readonly store: MemoryStore) {}

  async findAll(): Promise<Permission[]> {
    return Array.from(this.store.permissions.values());
  }

  async findByKey(key: string): Promise<Permission | null> {
    return this.store.permissions.get(key) ?? null;
  }

  async upsertMany(permissions: Permission[]): Promise<void> {
    for (const permission of permissions) {
      this.store.permissions.set(permission.key, permission);
    }
  }
}
