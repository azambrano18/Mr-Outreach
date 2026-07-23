import { CreateRoleInput, Role } from './role.entity';

export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findByName(organizationId: string, name: string): Promise<Role | null>;
  findAll(organizationId: string): Promise<Role[]>;
  create(input: CreateRoleInput): Promise<Role>;
  setPermissions(roleId: string, permissionKeys: string[]): Promise<void>;
  getPermissionKeys(roleId: string): Promise<string[]>;
}
