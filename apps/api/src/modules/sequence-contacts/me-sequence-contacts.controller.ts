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

/** §26-30/§49-50 — self-service: prospects/companies within the executive's own sequences. */
@ApiTags('me-sequence-contacts')
@ApiBearerAuth()
@Controller('me')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSequenceContactsController {
  constructor(
    private readonly sequenceContacts: SequenceContactsService,
    private readonly sequencesService: SequencesService,
    private readonly integration: IntegrationService,
  ) {}

  @Get('sequences/:sequenceId/contacts')
  @RequirePermissions('sequence_contacts.read')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @Query('status') status?: string,
    @Query('companyId') companyId?: string,
  ) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.sequenceContacts.list(user.organizationId, sequenceId, { status, companyId });
  }

  @Get('sequences/:sequenceId/companies')
  @RequirePermissions('sequence_contacts.read')
  async listCompanies(@CurrentUser() user: AuthenticatedUser, @Param('sequenceId') sequenceId: string) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
    return this.sequenceContacts.listCompanies(user.organizationId, sequenceId);
  }

  /** §27 — generates SEQUENCE_CONTACT_REMOVE_REQUESTED, cancels future jobs, keeps sent history. */
  @Post('sequences/:sequenceId/contacts/:sequenceContactId/remove')
  @RequirePermissions('sequence_contacts.remove')
  async removeContact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @Param('sequenceContactId') sequenceContactId: string,
    @Body() dto: RemoveSequenceContactDto,
  ) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
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

  /** §28 — affects every contact of this company within THIS sequence only, never a global exclusion. */
  @Post('sequences/:sequenceId/companies/:companyId/remove')
  @RequirePermissions('sequence_contacts.remove')
  async removeCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sequenceId') sequenceId: string,
    @Param('companyId') companyId: string,
    @Body() dto: RemoveSequenceCompanyDto,
  ) {
    await this.sequencesService.requireOwnedByExecutive(user.organizationId, sequenceId, user.id);
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
