import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { Role } from '../../domain/role/role.entity';
import { RoleRepository } from '../../domain/role/role.repository';
import { ROLE_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/**
 * Read-only for now: only enough to populate the role selector on the
 * executive create/edit forms. Creating custom roles or editing a role's
 * permission set is out of scope until it is actually asked for.
 */
@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository) {}

  @Get()
  @RequirePermissions('roles.read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<Role[]> {
    return this.roles.findAll(user.organizationId);
  }

  /** Backs the executive profile's "Permisos" tab — reuses the same lookup RoleRepository already exposes for authorization. */
  @Get(':id/permissions')
  @RequirePermissions('roles.read')
  async getPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<string[]> {
    const role = await this.roles.findById(id);
    if (!role || role.organizationId !== user.organizationId) {
      return [];
    }
    return this.roles.getPermissionKeys(id);
  }
}
