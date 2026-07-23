import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { MailboxesService } from '../../application/mailboxes/mailboxes.service';
import { MailboxSummary } from '../../application/mailboxes/mailboxes.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/**
 * `GET /clients/:clientId/mailboxes` and `GET /domains/:domainId/mailboxes`
 * — kept as their own controller (no shared `mailboxes` prefix) for the
 * same reason SequencesController uses `@Controller()`: these routes live
 * under the client/domain resource path, not under `/mailboxes`.
 */
@ApiTags('mailboxes')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MailboxHierarchyController {
  constructor(private readonly mailboxesService: MailboxesService) {}

  @Get('clients/:clientId/mailboxes')
  @RequirePermissions('mailboxes.read.all')
  listByClient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('clientId') clientId: string,
  ): Promise<MailboxSummary[]> {
    return this.mailboxesService.listByClient(user.organizationId, clientId);
  }

  @Get('domains/:domainId/mailboxes')
  @RequirePermissions('mailboxes.read.all')
  listByDomain(
    @CurrentUser() user: AuthenticatedUser,
    @Param('domainId') domainId: string,
  ): Promise<MailboxSummary[]> {
    return this.mailboxesService.listByDomain(user.organizationId, domainId);
  }
}
