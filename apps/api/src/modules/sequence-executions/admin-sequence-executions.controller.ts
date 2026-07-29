import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { RefreshExecutionStatusUseCase } from '../../application/sequence-executions/refresh-execution-status.use-case';
import { SequenceExecutionsService } from '../../application/sequence-executions/sequence-executions.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/**
 * §23 — read-only monitor. No route here ever creates, edits, or starts a
 * Gestión, uploads a base, changes a mapping, or changes a date — only
 * list/detail/refresh-status exist, deliberately mirroring the "Solo
 * lectura" requirement at the routing level, not just in the UI.
 */
@ApiTags('admin-sequence-executions')
@ApiBearerAuth()
@Controller('admin/sequence-executions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminSequenceExecutionsController {
  constructor(
    private readonly executions: SequenceExecutionsService,
    private readonly refreshUseCase: RefreshExecutionStatusUseCase,
  ) {}

  @Get()
  @RequirePermissions('sequence_executions.monitor_all')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.executions.listAllForOrganization(user.organizationId);
  }

  @Get(':id')
  @RequirePermissions('sequence_executions.monitor_all')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.executions.getAny(user.organizationId, id);
  }

  @Post(':id/refresh-status')
  @RequirePermissions('sequence_executions.refresh_status_all')
  refreshStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.refreshUseCase.execute(user.organizationId, user.id, id);
  }
}
