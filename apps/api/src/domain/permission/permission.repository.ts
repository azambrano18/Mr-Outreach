import { Permission } from './permission.entity';

export interface PermissionRepository {
  findAll(): Promise<Permission[]>;
  findByKey(key: string): Promise<Permission | null>;
  /** Idempotent: used to load/refresh the system permission catalog. */
  upsertMany(permissions: Permission[]): Promise<void>;
}
