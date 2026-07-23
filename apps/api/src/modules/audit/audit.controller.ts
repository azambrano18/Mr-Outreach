import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { AuditLogEntry } from '../../domain/audit/audit-log.entity';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { AUDIT_LOG_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/**
 * Read-only. Backs the executive profile's "Actividad" tab (scoped to
 * one actor) for now — a general org-wide audit log screen is a separate,
 * not-yet-requested feature.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(@Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository) {}

  @Get('users/:userId/audit-log')
  @RequirePermissions('audit.read')
  getForUser(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<AuditLogEntry[]> {
    return this.auditLogs.findAll(user.organizationId, { actorId: userId });
  }
}
