import { Role } from '../role/role.entity';

/**
 * Owns only the User<->Role join. Role's own CRUD lives in RoleRepository;
 * this port exists separately because assigning/reading a user's roles is
 * a distinct operation a service can depend on without needing the rest
 * of RoleRepository.
 */
export interface UserRoleRepository {
  assign(userId: string, roleId: string): Promise<void>;
  unassign(userId: string, roleId: string): Promise<void>;
  getRolesForUser(userId: string): Promise<Role[]>;
}
