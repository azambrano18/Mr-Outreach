import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IntegrationService } from '../../application/integration/integration.service';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { AuditLogEntry } from '../../domain/audit/audit-log.entity';
import { AuditLogRepository } from '../../domain/audit/audit-log.repository';
import { AUDIT_LOG_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { ConfigureMailboxResult, ConfigureMailboxUseCase } from '../../application/mailboxes/configure-mailbox.use-case';
import { IntrospectLinkTokenResult, LinkMailboxResult, LinkMailboxUseCase } from '../../application/mailboxes/link-mailbox.use-case';
import {
  ReassignMailboxPrimaryExecutiveResult,
  ReassignMailboxPrimaryExecutiveUseCase,
} from '../../application/mailboxes/reassign-mailbox-primary-executive.use-case';
import { UnlinkMailboxResult, UnlinkMailboxUseCase } from '../../application/mailboxes/unlink-mailbox.use-case';
import { MailboxProvisioningService } from '../../application/mailboxes/mailbox-provisioning.service';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import {
  UpdateMailboxConfigurationResult,
  UpdateMailboxConfigurationUseCase,
} from '../../application/mailboxes/update-mailbox-configuration.use-case';
import {
  AssigneeSummary,
  MailboxAdminOverviewItem,
  MailboxConnectionTestSummary,
  MailboxInboxSummary,
  MailboxSummary,
  MailboxTestResultSummary,
  MailboxThreadDetail,
  MailboxThreadReadStateResult,
} from '../../application/mailboxes/mailboxes.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdvanceProvisioningDto } from './dto/advance-provisioning.dto';
import { ConfigureMailboxDto } from './dto/configure-mailbox.dto';
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { IntrospectLinkTokenDto } from './dto/introspect-link-token.dto';
import { LinkDomainDto } from './dto/link-domain.dto';
import { LinkMailboxDto } from './dto/link-mailbox.dto';
import { ReassignMailboxPrimaryExecutiveDto } from './dto/reassign-mailbox-primary-executive.dto';
import { UnlinkMailboxDto } from './dto/unlink-mailbox.dto';
import { RequestProvisioningDto } from './dto/request-provisioning.dto';
import { SetMailboxAssigneesDto } from './dto/set-mailbox-assignees.dto';
import { SetProvisioningScenarioDto } from './dto/set-provisioning-scenario.dto';
import { SetThreadReadStateDto } from './dto/set-thread-read-state.dto';
import { UpdateMailboxConfigurationDto } from './dto/update-mailbox-configuration.dto';
import { UpdateMailboxDto } from './dto/update-mailbox.dto';

@ApiTags('mailboxes')
@ApiBearerAuth()
@Controller('mailboxes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MailboxesController {
  constructor(
    private readonly mailboxesService: MailboxesService,
    private readonly provisioning: MailboxProvisioningService,
    private readonly integration: IntegrationService,
    private readonly configureMailbox: ConfigureMailboxUseCase,
    private readonly updateMailboxConfiguration: UpdateMailboxConfigurationUseCase,
    private readonly linkMailbox: LinkMailboxUseCase,
    private readonly reassignPrimaryExecutive: ReassignMailboxPrimaryExecutiveUseCase,
    private readonly unlinkMailboxUseCase: UnlinkMailboxUseCase,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLogs: AuditLogRepository,
  ) {}

  /**
   * Fase 2.1, §14 — never deletes the account; only revokes Mr Outreach's
   * authorization to use it going forward. Idempotent.
   */
  @Post(':id/unlink')
  @RequirePermissions('mailboxes.unlink')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UnlinkMailboxDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<UnlinkMailboxResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const { result } = await this.unlinkMailboxUseCase.execute({
      organizationId: user.organizationId,
      mailboxId: id,
      reason: dto.reason,
      actorId: user.id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
    return result;
  }

  /** Fase 2.1, §14 — retries the post-commit motor confirmation for a mailbox stuck in UNLINK_REQUESTED. */
  @Post(':id/unlink/retry')
  @RequirePermissions('mailboxes.unlink')
  async retryUnlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UnlinkMailboxResult> {
    return this.unlinkMailboxUseCase.retryConfirmation(user.organizationId, id, user.id);
  }

  /**
   * Fase 2.1 — Paso 1 of "Vincular cuenta con token". Read-only: never
   * redeems, never creates anything, never persists the token.
   */
  /** Fase 2.1 §17 — rate-limited: tokens are otherwise freely retryable opaque strings, a plausible brute-force/enumeration target. */
  @Post('link-token/introspect')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions('mailboxes.link')
  async introspectLinkToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IntrospectLinkTokenDto,
  ): Promise<IntrospectLinkTokenResult> {
    return this.linkMailbox.introspect(user.organizationId, user.id, dto.token);
  }

  /**
   * Fase 2.1 — replaces manual IMAP/SMTP configuration as the standard way
   * to add a mailbox. Requires `Idempotency-Key`: the frontend generates it
   * once and must resend the exact same value on every retry of the same
   * attempt. Never accepts client/domain/email/serverMailboxId as trusted
   * input — those come exclusively from the motor's redemption response.
   */
  @Post('link')
  @RequirePermissions('mailboxes.link')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async link(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkMailboxDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<LinkMailboxResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const { result } = await this.linkMailbox.execute({
      organizationId: user.organizationId,
      token: dto.token,
      primaryExecutiveId: dto.primaryExecutiveId,
      secondaryExecutiveIds: dto.secondaryExecutiveIds,
      actorId: user.id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
    return result;
  }

  /**
   * Fase 2, Caso A — replaces the "crear → vincular dominio → provisionar →
   * avanzar" sequence of separate requests with one atomic, idempotent
   * intent. Requires `Idempotency-Key`: the frontend generates it once and
   * must resend the exact same value on every retry of the same attempt.
   */
  @Post('configure')
  @RequirePermissions('mailboxes.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async configure(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfigureMailboxDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<ConfigureMailboxResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const { result } = await this.configureMailbox.execute({
      organizationId: user.organizationId,
      crmClientId: dto.crmClientId,
      domainName: dto.domainName,
      email: dto.email,
      fromName: dto.fromName,
      replyTo: dto.replyTo ?? null,
      imap: dto.imap,
      smtp: dto.smtp,
      signatureHtml: dto.signatureHtml ?? null,
      primaryExecutiveId: dto.primaryExecutiveId ?? null,
      secondaryExecutiveIds: dto.secondaryExecutiveIds ?? [],
      actorId: user.id,
      idempotencyKey,
    });
    return result;
  }

  /**
   * Fase 2 — replaces the frontend-coordinated
   * `PATCH /mailboxes/:id` → `POST .../provision` → `POST .../provision/advance`
   * sequence with one atomic, idempotent intent (the edit-side counterpart
   * of `configure`). Every body field is optional; a field absent from the
   * request means "leave unchanged" (see UpdateMailboxConfigurationDto).
   */
  @Patch(':id/configure')
  @RequirePermissions('mailboxes.update')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async updateConfiguration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMailboxConfigurationDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<UpdateMailboxConfigurationResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const { result } = await this.updateMailboxConfiguration.execute({
      organizationId: user.organizationId,
      mailboxId: id,
      name: dto.name,
      email: dto.email,
      fromName: dto.fromName,
      replyTo: dto.replyTo,
      imap: dto.imap,
      smtp: dto.smtp,
      signatureHtml: dto.signatureHtml,
      primaryExecutiveId: dto.primaryExecutiveId,
      secondaryExecutiveIds: dto.secondaryExecutiveIds,
      actorId: user.id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
    return result;
  }

  /**
   * Fase 2.1, §13 — never requires a token, never touches client/domain/
   * email, never calls the motor. Works for both SERVER_TOKEN and
   * LEGACY_LOCAL mailboxes.
   */
  @Patch(':id/primary-executive')
  @RequirePermissions('mailboxes.assign')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async reassignPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReassignMailboxPrimaryExecutiveDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<ReassignMailboxPrimaryExecutiveResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const { result } = await this.reassignPrimaryExecutive.execute({
      organizationId: user.organizationId,
      mailboxId: id,
      newPrimaryExecutiveId: dto.newPrimaryExecutiveId,
      reason: dto.reason,
      actorId: user.id,
      idempotencyKey,
      correlationId: dto.correlationId,
    });
    return result;
  }

  @Get()
  @RequirePermissions('mailboxes.read.all')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('executiveId') executiveId?: string,
  ): Promise<MailboxSummary[]> {
    return this.mailboxesService.list(user.organizationId, executiveId);
  }

  /** §12.1 — denormalized rows (client/domain/primary executive names) for the admin listing/filter screen. Must stay before ':id' below. */
  @Get('overview')
  @RequirePermissions('mailboxes.read.all')
  overview(@CurrentUser() user: AuthenticatedUser): Promise<MailboxAdminOverviewItem[]> {
    return this.mailboxesService.listAdminOverview(user.organizationId);
  }

  @Post()
  @RequirePermissions('mailboxes.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMailboxDto,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.create(user.organizationId, dto, user.id);
  }

  @Get(':id')
  @RequirePermissions('mailboxes.read.all')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.getById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions('mailboxes.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMailboxDto,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.update(user.organizationId, id, dto, user.id);
  }

  @Post(':id/activate')
  @RequirePermissions('mailboxes.disable')
  activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.setStatus(user.organizationId, id, 'ACTIVE', user.id);
  }

  @Post(':id/deactivate')
  @RequirePermissions('mailboxes.disable')
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.setStatus(user.organizationId, id, 'INACTIVE', user.id);
  }

  @Post(':id/test')
  @RequirePermissions('mailboxes.test')
  testConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxTestResultSummary> {
    return this.mailboxesService.testConnection(user.organizationId, id, user.id);
  }

  /** Fase 2.1, §7/§12 — live status refresh for a SERVER_TOKEN mailbox. */
  @Post(':id/refresh-status')
  @RequirePermissions('mailboxes.refresh_status')
  async refreshStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.refreshServerStatus(user.organizationId, id, user.id);
  }

  @Get(':id/connection-tests')
  @RequirePermissions('mailboxes.read.all')
  getConnectionTests(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxConnectionTestSummary[]> {
    return this.mailboxesService.getConnectionTests(user.organizationId, id);
  }

  @Get(':id/inbox')
  @RequirePermissions('mailboxes.read.all')
  getInbox(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxInboxSummary> {
    return this.mailboxesService.getInbox(user.organizationId, id);
  }

  @Get(':id/inbox/threads/:threadId')
  @RequirePermissions('mailboxes.read.all')
  getThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('threadId') threadId: string,
  ): Promise<MailboxThreadDetail> {
    return this.mailboxesService.getThread(user.organizationId, id, threadId);
  }

  @Post(':id/inbox/threads/:threadId/read-state')
  @RequirePermissions('mailboxes.read.all')
  setThreadReadState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() dto: SetThreadReadStateDto,
  ): Promise<MailboxThreadReadStateResult> {
    return this.mailboxesService.setThreadReadState(
      user.organizationId,
      id,
      threadId,
      dto.isUnread,
      user.id,
    );
  }

  @Post(':id/link-domain')
  @RequirePermissions('mailboxes.update')
  linkToDomain(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LinkDomainDto,
  ): Promise<MailboxSummary> {
    return this.mailboxesService.linkToDomain(user.organizationId, id, dto.domainId, user.id);
  }

  @Get(':id/assignees')
  @RequirePermissions('mailboxes.assign')
  getAssignees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AssigneeSummary[]> {
    return this.mailboxesService.getAssignees(user.organizationId, id);
  }

  @Put(':id/assignees')
  @RequirePermissions('mailboxes.assign')
  setAssignees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetMailboxAssigneesDto,
  ): Promise<AssigneeSummary[]> {
    return this.mailboxesService.setAssignees(
      user.organizationId,
      id,
      { primaryUserId: dto.primaryUserId ?? null, secondaryUserIds: dto.secondaryUserIds ?? [] },
      user.id,
    );
  }

  /** Read-only audit trail for this mailbox (link, unlink, reassignment, status changes, etc.). */
  @Get(':id/audit-log')
  @RequirePermissions('audit.read')
  getAuditLog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AuditLogEntry[]> {
    return this.auditLogs.findAll(user.organizationId, { entityType: 'Mailbox', entityId: id });
  }

  /** §8-10 — "Guardar cuenta" triggers this: generates MAILBOX_PROVISION_REQUESTED instead of a synchronous connect. */
  @Post(':id/provision')
  @RequirePermissions('mailboxes.provision')
  async requestProvisioning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RequestProvisioningDto,
  ) {
    const { mailbox, command, duplicate } = await this.provisioning.requestProvisioning(
      user.organizationId,
      id,
      user.id,
      dto.idempotencyKey,
    );
    return {
      mailbox: await this.mailboxesService.getById(user.organizationId, mailbox.id),
      command: { ...command, payload: this.integration.redact(command.payload) },
      duplicate,
    };
  }

  /** §41 — choose the outcome the NEXT simulated advance will follow for this mailbox's provisioning command. */
  @Post(':id/provision/scenario')
  @RequirePermissions('simulation.manage')
  async setProvisioningScenario(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetProvisioningScenarioDto,
  ) {
    const mailbox = await this.mailboxesService.getById(user.organizationId, id);
    if (!mailbox.lastProvisionCommandId) return { ok: false };
    this.provisioning.setScenario(mailbox.lastProvisionCommandId, dto.scenario);
    return { ok: true };
  }

  /** §42 — manual advancement: ONE records the next planned event, ALL records every remaining one. */
  @Post(':id/provision/advance')
  @RequirePermissions('mailboxes.provision')
  async advanceProvisioning(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdvanceProvisioningDto,
  ) {
    const { mailbox, events } = await this.provisioning.advance(user.organizationId, id, dto.mode, user.id);
    return {
      mailbox: await this.mailboxesService.getById(user.organizationId, mailbox.id),
      events,
    };
  }

  /** §40 — JSON viewer: the submitted command (redacted) plus every planned/recorded event for it. */
  @Get(':id/provision/command')
  @RequirePermissions('mailboxes.provision')
  async getProvisioningCommand(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const mailbox = await this.mailboxesService.getById(user.organizationId, id);
    if (!mailbox.lastProvisionCommandId) {
      return { command: null, plannedEvents: [], recordedEvents: [] };
    }
    const command = await this.integration.getCommand(user.organizationId, mailbox.lastProvisionCommandId);
    const [plannedEvents, recordedEvents] = await Promise.all([
      this.integration.listPlannedEvents(user.organizationId, mailbox.lastProvisionCommandId),
      this.integration.listEventsForCommand(user.organizationId, mailbox.lastProvisionCommandId),
    ]);
    return {
      command: { ...command, payload: this.integration.redact(command.payload) },
      plannedEvents,
      recordedEvents,
    };
  }
}
