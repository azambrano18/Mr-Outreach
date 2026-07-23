import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '../../application/integration/integration.service';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { MailboxProvisioningService } from '../../application/mailboxes/mailbox-provisioning.service';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import {
  AssigneeSummary,
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
import { CreateMailboxDto } from './dto/create-mailbox.dto';
import { LinkDomainDto } from './dto/link-domain.dto';
import { RequestProvisioningDto } from './dto/request-provisioning.dto';
import { SetMailboxAssigneesDto } from './dto/set-mailbox-assignees.dto';
import { SetProvisioningScenarioDto } from './dto/set-provisioning-scenario.dto';
import { SetThreadReadStateDto } from './dto/set-thread-read-state.dto';
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
  ) {}

  @Get()
  @RequirePermissions('mailboxes.read.all')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('executiveId') executiveId?: string,
  ): Promise<MailboxSummary[]> {
    return this.mailboxesService.list(user.organizationId, executiveId);
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
