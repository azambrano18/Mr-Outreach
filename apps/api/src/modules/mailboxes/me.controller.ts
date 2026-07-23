import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import {
  AssigneeSummary,
  AssignedMailboxSummary,
  MailboxInboxSummary,
  MailboxSummary,
  MailboxThreadDetail,
  MailboxThreadReadStateResult,
} from '../../application/mailboxes/mailboxes.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SetThreadReadStateDto } from './dto/set-thread-read-state.dto';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  @Get('mailboxes')
  @RequirePermissions('mailboxes.read.assigned')
  getMyMailboxes(@CurrentUser() user: AuthenticatedUser): Promise<AssignedMailboxSummary[]> {
    return this.mailboxesService.getAssignedMailboxesForUser(user.organizationId, user.id);
  }

  @Get('mailboxes/:id/inbox')
  @RequirePermissions('mailboxes.read.assigned')
  getMyInbox(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MailboxInboxSummary> {
    return this.mailboxesService.getInboxForExecutive(user.organizationId, user.id, id);
  }

  @Get('mailboxes/:id/inbox/threads/:threadId')
  @RequirePermissions('mailboxes.read.assigned')
  getMyThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('threadId') threadId: string,
  ): Promise<MailboxThreadDetail> {
    return this.mailboxesService.getThreadForExecutive(user.organizationId, user.id, id, threadId);
  }

  @Get('clients/:clientId/mailboxes')
  @RequirePermissions('mailboxes.read.assigned')
  getMyMailboxesByClient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
  ): Promise<MailboxSummary[]> {
    return this.mailboxesService.listByClientForExecutive(user.organizationId, user.id, clientId);
  }

  @Get('domains/:domainId/mailboxes')
  @RequirePermissions('mailboxes.read.assigned')
  getMyMailboxesByDomain(
    @CurrentUser() user: AuthenticatedUser,
    @Param('domainId') domainId: string,
  ): Promise<MailboxSummary[]> {
    return this.mailboxesService.listByDomainForExecutive(user.organizationId, user.id, domainId);
  }

  @Get('mailboxes/:id/assignees')
  @RequirePermissions('mailboxes.read.assigned')
  getMyMailboxAssignees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AssigneeSummary[]> {
    return this.mailboxesService.getAssigneesForExecutive(user.organizationId, user.id, id);
  }

  @Post('mailboxes/:id/inbox/threads/:threadId/read-state')
  @RequirePermissions('mailboxes.read.assigned')
  setMyThreadReadState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() dto: SetThreadReadStateDto,
  ): Promise<MailboxThreadReadStateResult> {
    return this.mailboxesService.setThreadReadStateForExecutive(
      user.organizationId,
      user.id,
      id,
      threadId,
      dto.isUnread,
    );
  }
}
