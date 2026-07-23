import { Controller, Delete, Param, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConversationsService } from '../../application/conversations/conversations.service';
import { ConversationNoteSummary } from '../../application/conversations/conversations.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UpdateConversationNoteDto } from './dto/update-conversation-note.dto';

@ApiTags('conversation-notes')
@ApiBearerAuth()
@Controller('conversation-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationNotesController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Patch(':id')
  @RequirePermissions('conversation_notes.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationNoteDto,
  ): Promise<ConversationNoteSummary> {
    return this.conversationsService.updateNote(user.organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('conversation_notes.delete')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.conversationsService.deleteNote(user.organizationId, id, user.id);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/conversation-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeConversationNotesController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Patch(':id')
  @RequirePermissions('conversation_notes.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationNoteDto,
  ): Promise<ConversationNoteSummary> {
    return this.conversationsService.updateNoteForExecutive(
      user.organizationId,
      user.id,
      id,
      dto,
      user.id,
    );
  }

  @Delete(':id')
  @RequirePermissions('conversation_notes.delete')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.conversationsService.deleteNoteForExecutive(
      user.organizationId,
      user.id,
      id,
      user.id,
    );
  }
}
