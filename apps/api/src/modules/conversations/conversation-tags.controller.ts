import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConversationsService } from '../../application/conversations/conversations.service';
import { ConversationTagSummary } from '../../application/conversations/conversations.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateConversationTagDto } from './dto/create-conversation-tag.dto';
import { UpdateConversationTagDto } from './dto/update-conversation-tag.dto';

/** Tags belong to the organization (§18), not to a client/executive — one controller serves both admin and executive callers, gated purely by permission. */
@ApiTags('conversation-tags')
@ApiBearerAuth()
@Controller('conversation-tags')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationTagsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @RequirePermissions('conversation_tags.read')
  list(@CurrentUser() user: AuthenticatedUser): Promise<ConversationTagSummary[]> {
    return this.conversationsService.listTags(user.organizationId);
  }

  @Post()
  @RequirePermissions('conversation_tags.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConversationTagDto,
  ): Promise<ConversationTagSummary> {
    return this.conversationsService.createTag(user.organizationId, dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('conversation_tags.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationTagDto,
  ): Promise<ConversationTagSummary> {
    return this.conversationsService.updateTag(user.organizationId, id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('conversation_tags.delete')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.conversationsService.deleteTag(user.organizationId, id, user.id);
  }
}
