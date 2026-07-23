import {
  Body,
  Controller,
  Delete,
  Get,
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
  ConversationTreeClientNode,
} from '../../application/conversations/conversations.types';
import { ResponseOutcomeService } from '../../application/response-outcome/response-outcome.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AssociateConversationDto } from './dto/associate-conversation.dto';
import { CreateConversationNoteDto } from './dto/create-conversation-note.dto';
import { DoNotContactDto } from './dto/do-not-contact.dto';
import { ReferProspectDto } from './dto/refer-prospect.dto';
import { ResponseOutcomeReasonDto } from './dto/response-outcome-reason.dto';
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

/** "Centro de conversaciones" self-service entry point — scoping enforced in ConversationsService, not just hidden in the UI. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly responseOutcome: ResponseOutcomeService,
  ) {}

  @Get()
  @RequirePermissions('conversations.read.assigned')
  list(
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
    return this.conversationsService.listForExecutive(
      user.organizationId,
      user.id,
      filter,
      user.id,
    );
  }

  @Get('counters')
  @RequirePermissions('conversations.read.assigned')
  counters(
    @CurrentUser() user: AuthenticatedUser,
    @Query('clientId') clientId?: string,
    @Query('domainId') domainId?: string,
    @Query('mailboxId') mailboxId?: string,
  ): Promise<ConversationCounters> {
    const filter = parseListFilter({ clientId, domainId, mailboxId });
    return this.conversationsService.countersForExecutive(
      user.organizationId,
      user.id,
      filter,
      user.id,
    );
  }

  /** "Cuentas de correos" — the Cliente → Dominio → Cuenta tree with aggregated unread counts. */
  @Get('tree')
  @RequirePermissions('conversations.read.assigned')
  getTree(@CurrentUser() user: AuthenticatedUser): Promise<ConversationTreeClientNode[]> {
    return this.conversationsService.getConversationTreeForExecutive(
      user.organizationId,
      user.id,
      user.id,
    );
  }

  @Get(':id')
  @RequirePermissions('conversations.read.assigned')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationDetail> {
    return this.conversationsService.getByIdForExecutive(user.organizationId, user.id, id);
  }

  @Patch(':id/status')
  @RequirePermissions('conversations.update')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationStatusDto,
  ): Promise<ConversationSummary> {
    return this.conversationsService.updateManagementStatusForExecutive(
      user.organizationId,
      user.id,
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
    return this.conversationsService.updateClassificationForExecutive(
      user.organizationId,
      user.id,
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
    return this.conversationsService.updateAssignmentForExecutive(
      user.organizationId,
      user.id,
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
    return this.conversationsService.updateManagementStatusForExecutive(
      user.organizationId,
      user.id,
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
    return this.conversationsService.updateManagementStatusForExecutive(
      user.organizationId,
      user.id,
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
    return this.conversationsService.associateManuallyForExecutive(
      user.organizationId,
      user.id,
      id,
      dto,
      user.id,
    );
  }

  @Post(':id/tags')
  @RequirePermissions('conversations.update')
  async addTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('tagId') tagId: string,
  ): Promise<void> {
    await this.conversationsService.addTagForExecutive(
      user.organizationId,
      user.id,
      id,
      tagId,
      user.id,
    );
  }

  @Delete(':id/tags/:tagId')
  @RequirePermissions('conversations.update')
  async removeTag(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ): Promise<void> {
    await this.conversationsService.removeTagForExecutive(
      user.organizationId,
      user.id,
      id,
      tagId,
      user.id,
    );
  }

  @Get(':id/notes')
  @RequirePermissions('conversation_notes.read')
  listNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationNoteSummary[]> {
    return this.conversationsService.listNotesForExecutive(user.organizationId, user.id, id);
  }

  @Post(':id/notes')
  @RequirePermissions('conversation_notes.create')
  createNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateConversationNoteDto,
  ): Promise<ConversationNoteSummary> {
    return this.conversationsService.createNoteForExecutive(
      user.organizationId,
      user.id,
      id,
      dto,
      user.id,
    );
  }

  /** Resultado de la respuesta: No interesado — detiene la secuencia para TODA la empresa. */
  @Post(':id/response-outcome/not-interested')
  @RequirePermissions('sequence_contacts.remove')
  async notInterested(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResponseOutcomeReasonDto,
  ) {
    await this.conversationsService.requireAccessibleConversation(user.organizationId, user.id, id);
    const { conversationId, ...rest } = await this.responseOutcome.notInterested(user.organizationId, id, user.id, dto.reason);
    return { ...rest, conversation: await this.conversationsService.getById(user.organizationId, conversationId) };
  }

  /** Resultado de la respuesta: Interesado — también detiene la secuencia para TODA la empresa. */
  @Post(':id/response-outcome/interested')
  @RequirePermissions('sequence_contacts.remove')
  async interested(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResponseOutcomeReasonDto,
  ) {
    await this.conversationsService.requireAccessibleConversation(user.organizationId, user.id, id);
    const { conversationId, ...rest } = await this.responseOutcome.interested(user.organizationId, id, user.id, dto.reason);
    return { ...rest, conversation: await this.conversationsService.getById(user.organizationId, conversationId) };
  }

  /** Resultado de la respuesta: No contactar — exclusión global para esta ÚNICA dirección de correo. */
  @Post(':id/response-outcome/do-not-contact')
  @RequirePermissions('sequence_contacts.suppress')
  async doNotContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DoNotContactDto,
  ) {
    await this.conversationsService.requireAccessibleConversation(user.organizationId, user.id, id);
    const { conversationId, ...rest } = await this.responseOutcome.doNotContact(user.organizationId, id, user.id, dto.reason);
    return { ...rest, conversation: await this.conversationsService.getById(user.organizationId, conversationId) };
  }

  /** Resultado de la respuesta: Deriva — saca a este contacto y matricula al nuevo en la misma secuencia. */
  @Post(':id/response-outcome/refer')
  @RequirePermissions('sequence_contacts.remove')
  async refer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReferProspectDto,
  ) {
    await this.conversationsService.requireAccessibleConversation(user.organizationId, user.id, id);
    const { conversationId, ...rest } = await this.responseOutcome.refer(user.organizationId, id, user.id, dto);
    return { ...rest, conversation: await this.conversationsService.getById(user.organizationId, conversationId) };
  }
}
