import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { IntegrationService } from '../../application/integration/integration.service';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdvanceCommandDto } from './dto/advance-command.dto';

/**
 * §37-40 — "Monitor de integración". Admin-only, and only meaningful in
 * MAIL_ENGINE_MODE=simulation (the whole point is inspecting/advancing the
 * simulated Outbox/Inbox — a real remote engine wouldn't expose a "advance
 * this command" button). Scope note: this covers Resumen/Comandos/Eventos
 * — the spec's Importaciones/Jobs/Lotes/Mensajes/Escenarios tabs are
 * already served by the resource-specific screens built earlier in this
 * phase (sequence imports, scheduled emails, reply simulation), so they
 * are not duplicated here as a second view over the same data.
 */
@ApiTags('integration-monitor')
@ApiBearerAuth()
@Controller('integration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntegrationMonitorController {
  constructor(
    private readonly integration: IntegrationService,
    private readonly config: AppConfigService,
  ) {}

  @Get('summary')
  @RequirePermissions('integration_commands.read')
  async summary(@CurrentUser() user: AuthenticatedUser) {
    const [commands, events] = await Promise.all([
      this.integration.listCommands(user.organizationId),
      this.integration.listEvents(user.organizationId),
    ]);
    const byStatus = <T extends { status: string }>(rows: T[]) =>
      rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {});

    return {
      mailEngineMode: this.config.mailEngineMode,
      totalCommands: commands.length,
      commandsByStatus: byStatus(commands),
      totalEvents: events.length,
      eventsByStatus: byStatus(events),
    };
  }

  @Get('commands')
  @RequirePermissions('integration_commands.read')
  async listCommands(
    @CurrentUser() user: AuthenticatedUser,
    @Query('aggregateType') aggregateType?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const commands = await this.integration.listCommands(user.organizationId, { aggregateType, status, search });
    return commands.map((command) => ({ ...command, payload: this.integration.redact(command.payload) }));
  }

  @Get('commands/:commandId')
  @RequirePermissions('integration_commands.read')
  async getCommand(@CurrentUser() user: AuthenticatedUser, @Param('commandId') commandId: string) {
    const command = await this.integration.getCommand(user.organizationId, commandId);
    const events = await this.integration.listEventsForCommand(user.organizationId, commandId);
    const plannedEvents =
      this.config.mailEngineMode === 'simulation'
        ? await this.integration.listPlannedEvents(user.organizationId, commandId)
        : [];
    return {
      command: { ...command, payload: this.integration.redact(command.payload) },
      events,
      plannedEvents,
    };
  }

  /** §42 — manual advancement from the monitor, for any command regardless of which feature created it. */
  @Post('commands/:commandId/advance')
  @RequirePermissions('simulation.manage')
  advanceCommand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commandId') commandId: string,
    @Body() dto: AdvanceCommandDto,
  ) {
    return this.integration.advance(user.organizationId, commandId, dto.mode, user.id);
  }

  @Get('events')
  @RequirePermissions('integration_events.read')
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('eventType') eventType?: string,
    @Query('status') status?: string,
    @Query('commandId') commandId?: string,
  ) {
    return this.integration.listEvents(user.organizationId, { eventType, status, commandId });
  }

  @Post('events/:eventId/reprocess')
  @RequirePermissions('integration_events.retry')
  reprocessEvent(@CurrentUser() user: AuthenticatedUser, @Param('eventId') eventId: string) {
    return this.integration.reprocessEvent(user.organizationId, eventId, user.id);
  }
}
