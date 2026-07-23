import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { DomainsService } from '../../application/domains/domains.service';
import { DomainSummary } from '../../application/domains/domains.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';

@ApiTags('domains')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Get('clients/:clientId/domains')
  @RequirePermissions('domains.read')
  listByClient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
  ): Promise<DomainSummary[]> {
    return this.domainsService.listByClient(user.organizationId, clientId);
  }

  @Post('clients/:clientId/domains')
  @RequirePermissions('domains.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
    @Body() dto: CreateDomainDto,
  ): Promise<DomainSummary> {
    return this.domainsService.create(user.organizationId, clientId, dto, user.id);
  }

  @Get('domains/:domainId')
  @RequirePermissions('domains.read')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('domainId') domainId: string,
  ): Promise<DomainSummary> {
    return this.domainsService.getById(user.organizationId, domainId);
  }

  @Patch('domains/:domainId')
  @RequirePermissions('domains.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('domainId') domainId: string,
    @Body() dto: UpdateDomainDto,
  ): Promise<DomainSummary> {
    return this.domainsService.update(user.organizationId, domainId, dto, user.id);
  }

  @Delete('domains/:domainId')
  @RequirePermissions('domains.delete')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('domainId') domainId: string,
  ): Promise<void> {
    await this.domainsService.remove(user.organizationId, domainId, user.id);
  }
}
