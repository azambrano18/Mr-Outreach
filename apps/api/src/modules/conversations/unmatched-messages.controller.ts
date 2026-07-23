import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConversationsService } from '../../application/conversations/conversations.service';
import { ConversationSummary } from '../../application/conversations/conversations.types';
import { MailboxRepository } from '../../domain/mailbox/mailbox.repository';
import { MAILBOX_REPOSITORY } from '../../infrastructure/persistence/tokens';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AssociateConversationDto } from './dto/associate-conversation.dto';

/**
 * "Mensajes sin identificar" (§25) — conversations whose mailbox has no
 * client/domain yet, so nothing about them could be categorized. This is
 * a filtered view of the same Conversation table, not a separate entity —
 * see ConversationRepository's `unmatchedOnly` filter.
 */
@ApiTags('unmatched-messages')
@ApiBearerAuth()
@Controller('unmatched-messages')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UnmatchedMessagesController {
  constructor(
    private readonly conversationsService: ConversationsService,
    @Inject(MAILBOX_REPOSITORY) private readonly mailboxes: MailboxRepository,
  ) {}

  @Get()
  @RequirePermissions('unmatched_messages.read')
  async list(@CurrentUser() user: AuthenticatedUser): Promise<ConversationSummary[]> {
    const rows = await this.mailboxes.findAll(user.organizationId);
    const mailboxIds = rows.map((row) => row.id);
    return this.conversationsService.list(
      user.organizationId,
      { unmatchedOnly: true },
      mailboxIds,
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

  @Post(':id/ignore')
  @RequirePermissions('unmatched_messages.associate')
  ignore(
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

  @Post(':id/archive')
  @RequirePermissions('unmatched_messages.associate')
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
}
