import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { DomainsService } from '../../application/domains/domains.service';
import { DomainSummary } from '../../application/domains/domains.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeDomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Get('clients/:clientId/domains')
  @RequirePermissions('domains.read')
  listByClient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
  ): Promise<DomainSummary[]> {
    return this.domainsService.listByClientForExecutive(user.organizationId, user.id, clientId);
  }

  @Get('domains/:domainId')
  @RequirePermissions('domains.read')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('domainId') domainId: string,
  ): Promise<DomainSummary> {
    return this.domainsService.getByIdForExecutive(user.organizationId, user.id, domainId);
  }
}
