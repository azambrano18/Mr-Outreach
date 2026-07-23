import { Inject, Injectable } from '@nestjs/common';
import { ROLE_REPOSITORY, USER_ROLE_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { RoleRepository } from '../../domain/role/role.repository';
import { UserRoleRepository } from '../../domain/user-role/user-role.repository';

/**
 * Computes a user's effective permissions fresh, on every call — never
 * cached in a JWT payload, so a permission/role change takes effect on
 * the user's very next request instead of only after re-login.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(USER_ROLE_REPOSITORY) private readonly userRoles: UserRoleRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
  ) {}

  async getPermissionKeysForUser(userId: string): Promise<string[]> {
    const assignedRoles = await this.userRoles.getRolesForUser(userId);
    const permissionKeys = new Set<string>();

    for (const role of assignedRoles) {
      const keys = await this.roles.getPermissionKeys(role.id);
      keys.forEach((key) => permissionKeys.add(key));
    }

    return Array.from(permissionKeys);
  }
}
