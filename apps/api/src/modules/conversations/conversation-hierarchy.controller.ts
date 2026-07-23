import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { ConversationsService } from '../../application/conversations/conversations.service';
import { ConversationTreeClientNode } from '../../application/conversations/conversations.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/**
 * `GET /clients/:clientId/conversations/tree` — kept as its own controller
 * (no shared `conversations` prefix), same reason as `MailboxHierarchyController`:
 * this route lives under the client resource path. Spec §7 — the admin's
 * "Todas las conversaciones" view reuses the exact same Cliente→Dominio→Cuenta
 * tree shape as the executive's `/me/conversations/tree`, just scoped by
 * `clientId` directly instead of by an executive's own assignments.
 */
@ApiTags('conversations')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationHierarchyController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get('clients/:clientId/conversations/tree')
  @RequirePermissions('conversations.read.all')
  getTreeForClient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
  ): Promise<ConversationTreeClientNode[]> {
    return this.conversationsService.getConversationTreeForClient(user.organizationId, clientId, user.id);
  }
}
