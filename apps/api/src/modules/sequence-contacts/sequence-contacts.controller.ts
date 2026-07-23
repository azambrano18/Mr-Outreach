import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { IntegrationService } from '../../application/integration/integration.service';
import { SequenceContactsService } from '../../application/sequence-contacts/sequence-contacts.service';
import { SequencesService } from '../../application/sequences/sequences.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RemoveSequenceCompanyDto } from './dto/remove-sequence-company.dto';
import { RemoveSequenceContactDto } from './dto/remove-sequence-contact.dto';

/**
 * Admin equivalent of MeSequenceContactsController — used from the global
 * monitoring panel (spec §4.5) to retire a prospect/company from ANY
 * executive's sequence, not just one's own. Reuses SequenceContactsService
 * as-is (its methods are already org-scoped, never owner-scoped — the
 * self-service controller is the one that adds the ownership check via
 * requireOwnedByExecutive); here `sequencesService.getById` provides the
 * same 404-not-403 masking without restricting to a particular executive.
 */
@ApiTags('sequence-contacts')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SequenceContactsController {
  constructor(
    private readonly sequenceContacts: SequenceContactsService,
    private readonly sequencesService: SequencesService,
    private readonly integration: IntegrationService,
  ) {}

  @Get('sequences/:sequenceId/contacts')
  @RequirePermissions('sequences.read_all')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @Query('status') status?: string,
    @Query('companyId') companyId?: string,
  ) {
    await this.sequencesService.getById(user.organizationId, sequenceId);
    return this.sequenceContacts.list(user.organizationId, sequenceId, { status, companyId });
  }

  @Get('sequences/:sequenceId/companies')
  @RequirePermissions('sequences.read_all')
  async listCompanies(@CurrentUser() user: AuthenticatedUser, @Param('sequenceId') sequenceId: string) {
    await this.sequencesService.getById(user.organizationId, sequenceId);
    return this.sequenceContacts.listCompanies(user.organizationId, sequenceId);
  }

  @Post('sequences/:sequenceId/contacts/:sequenceContactId/remove')
  @RequirePermissions('sequences.prospects.remove')
  async removeContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @Param('sequenceContactId') sequenceContactId: string,
    @Body() dto: RemoveSequenceContactDto,
  ) {
    await this.sequencesService.getById(user.organizationId, sequenceId);
    const result = await this.sequenceContacts.removeContact(
      user.organizationId,
      sequenceId,
      sequenceContactId,
      dto.reason,
      user.id,
      dto.idempotencyKey,
    );
    return { ...result, command: { ...result.command, payload: this.integration.redact(result.command.payload) } };
  }

  @Post('sequences/:sequenceId/companies/:companyId/remove')
  @RequirePermissions('sequences.companies.remove')
  async removeCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @Param('companyId') companyId: string,
    @Body() dto: RemoveSequenceCompanyDto,
  ) {
    await this.sequencesService.getById(user.organizationId, sequenceId);
    const result = await this.sequenceContacts.removeCompany(
      user.organizationId,
      sequenceId,
      companyId,
      dto.reason,
      user.id,
      dto.idempotencyKey,
    );
    return { ...result, command: { ...result.command, payload: this.integration.redact(result.command.payload) } };
  }
}
