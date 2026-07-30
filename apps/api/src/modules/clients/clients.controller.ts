import { Body, Controller, Delete, Get, Inject, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminClientsService } from '../../application/admin-clients/admin-clients.service';
import { AdminClientsListResult } from '../../application/admin-clients/admin-clients.types';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import {
  ClientAssigneeSummary,
  ManagedClientSummary,
} from '../../application/clients/clients.types';
import { ClientsService } from '../../application/clients/clients.service';
import { AuditLogEntry } from '../../domain/audit/audit-log.entity';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { AUDIT_LOG_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SetClientAssigneesDto } from './dto/set-client-assignees.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly adminClientsService: AdminClientsService,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  @Get()
  @RequirePermissions('clients.read.all')
  list(@CurrentUser() user: AuthenticatedUser): Promise<ManagedClientSummary[]> {
    return this.clientsService.list(user.organizationId);
  }

  // Must be declared before ':id' below, or Nest/Express would try to
  // match "overview" as an :id param instead.
  @Get('overview')
  @RequirePermissions('clients.read.all')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
  ): Promise<AdminClientsListResult> {
    return this.adminClientsService.list(user.organizationId, search);
  }

  @Get(':id')
  @RequirePermissions('clients.read.all')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ManagedClientSummary> {
    return this.clientsService.getById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('clients.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ): Promise<ManagedClientSummary> {
    return this.clientsService.update(user.organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('clients.delete')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.clientsService.remove(user.organizationId, id, user.id);
  }

  @Get(':id/assignees')
  @RequirePermissions('clients.read.all')
  getAssignees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ClientAssigneeSummary[]> {
    return this.clientsService.getAssignees(user.organizationId, id);
  }

  @Get(':id/audit-log')
  @RequirePermissions('audit.read')
  async getAuditLog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AuditLogEntry[]> {
    await this.clientsService.getById(user.organizationId, id); // 404s if not owned by this organization
    return this.auditLogs.findAll(user.organizationId, { entityType: 'ManagedClient', entityId: id });
  }

  @Put(':id/assignees')
  @RequirePermissions('clients.assign')
  setAssignees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetClientAssigneesDto,
  ): Promise<ClientAssigneeSummary[]> {
    return this.clientsService.setAssignees(
      user.organizationId,
      id,
      { primaryUserId: dto.primaryUserId ?? null, secondaryUserIds: dto.secondaryUserIds ?? [] },
      user.id,
    );
  }
}
