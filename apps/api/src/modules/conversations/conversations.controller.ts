import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConversationsService } from '../../application/conversations/conversations.service';
import {
  ConversationCounters,
  ConversationDetail,
  ConversationListFilter,
  ConversationNoteSummary,
  ConversationSummary,
} from '../../application/conversations/conversations.types';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MAILBOX_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AssociateConversationDto } from './dto/associate-conversation.dto';
import { CreateConversationNoteDto } from './dto/create-conversation-note.dto';
import { UpdateConversationAssignmentDto } from './dto/update-conversation-assignment.dto';
import { UpdateConversationClassificationDto } from './dto/update-conversation-classification.dto';
import { UpdateConversationStatusDto } from './dto/update-conversation-status.dto';

function parseListFilter(query: Record<string, string | undefined>): ConversationListFilter {
  return {
    clientId: query.clientId,
    domainId: query.domainId,
    mailboxId: query.mailboxId,
    assignedExecutiveId: query.executiveId,
    sequenceId: query.sequenceId,
    managementStatus: query.status as ConversationListFilter['managementStatus'],
    classification: query.classification as ConversationListFilter['classification'],
    tagId: query.tagId,
    isUnread: query.unread === undefined ? undefined : query.unread === 'true',
    search: query.search,
    unmatchedOnly: query.unmatchedOnly === 'true',
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  };
}

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
  ) {}

  @Get()
  @RequirePermissions('conversations.read.all')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('clientId') clientId?: string,
    @Query('domainId') domainId?: string,
    @Query('mailboxId') mailboxId?: string,
    @Query('executiveId') executiveId?: string,
    @Query('sequenceId') sequenceId?: string,
    @Query('status') status?: string,
    @Query('classification') classification?: string,
    @Query('tagId') tagId?: string,
    @Query('unread') unread?: string,
    @Query('search') search?: string,
    @Query('unmatchedOnly') unmatchedOnly?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<ConversationSummary[]> {
    const filter = parseListFilter({
      clientId,
      domainId,
      mailboxId,
      executiveId,
      sequenceId,
      status,
      classification,
      tagId,
      unread,
      search,
      unmatchedOnly,
      dateFrom,
      dateTo,
    });
    const mailboxIdsToSync = await this.mailboxIdsInScope(user.organizationId, mailboxId);
    return this.conversationsService.list(user.organizationId, filter, mailboxIdsToSync, user.id);
  }

  @Get('counters')
  @RequirePermissions('conversations.read.all')
  async counters(
    @CurrentUser() user: AuthenticatedUser,
    @Query('clientId') clientId?: string,
    @Query('domainId') domainId?: string,
    @Query('mailboxId') mailboxId?: string,
  ): Promise<ConversationCounters> {
    const filter = parseListFilter({ clientId, domainId, mailboxId });
    const mailboxIdsToSync = await this.mailboxIdsInScope(user.organizationId, mailboxId);
    return this.conversationsService.counters(
      user.organizationId,
      filter,
      mailboxIdsToSync,
      user.id,
    );
  }

  @Get(':id')
  @RequirePermissions('conversations.read.all')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationDetail> {
    return this.conversationsService.getById(user.organizationId, id, { markAsRead: true, actorId: user.id });
  }

  @Patch(':id/status')
  @RequirePermissions('conversations.update')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationStatusDto,
  ): Promise<ConversationSummary> {
    return this.conversationsService.updateManagementStatus(
      user.organizationId,
      id,
      dto.managementStatus,
      user.id,
    );
  }

  @Patch(':id/classification')
  @RequirePermissions('conversations.update')
  updateClassification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationClassificationDto,
  ): Promise<ConversationSummary> {
    return this.conversationsService.updateClassification(
      user.organizationId,
      id,
      dto.classification,
      user.id,
    );
  }

  @Patch(':id/assignment')
  @RequirePermissions('conversations.assign')
  updateAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationAssignmentDto,
  ): Promise<ConversationSummary> {
    return this.conversationsService.updateAssignment(
      user.organizationId,
      id,
      dto.assignedExecutiveId ?? null,
      user.id,
    );
  }

  @Post(':id/archive')
  @RequirePermissions('conversations.archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationSummary> {
    return this.conversationsService.updateManagementStatus(
      user.organizationId,
      id,
      'ARCHIVED',
      user.id,
    );
  }

  @Post(':id/reopen')
  @RequirePermissions('conversations.resolve')
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationSummary> {
    return this.conversationsService.updateManagementStatus(
      user.organizationId,
      id,
      'IN_PROGRESS',
      user.id,
    );
  }

  @Post(':id/associate')
  @RequirePermissions('unmatched_messages.associate')
  associate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssociateConversationDto,
  ): Promise<ConversationSummary> {
    return this.conversationsService.associateManually(user.organizationId, id, dto, user.id);
  }

  @Post(':id/tags')
  @RequirePermissions('conversations.update')
  async addTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('tagId') tagId: string,
  ): Promise<void> {
    await this.conversationsService.addTag(user.organizationId, id, tagId, user.id);
  }

  @Delete(':id/tags/:tagId')
  @RequirePermissions('conversations.update')
  async removeTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ): Promise<void> {
    await this.conversationsService.removeTag(user.organizationId, id, tagId, user.id);
  }

  @Get(':id/notes')
  @RequirePermissions('conversation_notes.read')
  listNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationNoteSummary[]> {
    return this.conversationsService.listNotes(user.organizationId, id);
  }

  @Post(':id/notes')
  @RequirePermissions('conversation_notes.create')
  createNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateConversationNoteDto,
  ): Promise<ConversationNoteSummary> {
    return this.conversationsService.createNote(user.organizationId, id, dto, user.id);
  }

  private async mailboxIdsInScope(organizationId: string, mailboxId?: string): Promise<string[]> {
    if (mailboxId) return [mailboxId];
    const rows = await this.mailboxes.findAll(organizationId);
    return rows.map((row) => row.id);
  }
}
