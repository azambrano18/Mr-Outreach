import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { SignaturesService } from '../../application/signatures/signatures.service';
import {
  SendTestSignatureResult,
  SignaturePreview,
  SignatureSummary,
} from '../../application/signatures/signatures.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { SendTestSignatureDto } from './dto/send-test-signature.dto';
import { UpdateSignatureDto } from './dto/update-signature.dto';

@ApiTags('signatures')
@ApiBearerAuth()
@Controller('mailboxes/:mailboxId/signature')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Get()
  @RequirePermissions('signatures.read')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
  ): Promise<SignatureSummary> {
    return this.signaturesService.getByMailbox(user.organizationId, mailboxId);
  }

  @Post()
  @RequirePermissions('signatures.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: CreateSignatureDto,
  ): Promise<SignatureSummary> {
    return this.signaturesService.create(
      user.organizationId,
      mailboxId,
      dto.htmlContent,
      dto.plainTextContent,
      user.id,
    );
  }

  @Patch()
  @RequirePermissions('signatures.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: UpdateSignatureDto,
  ): Promise<SignatureSummary> {
    return this.signaturesService.update(
      user.organizationId,
      mailboxId,
      dto.htmlContent,
      dto.plainTextContent,
      user.id,
    );
  }

  @Post('versions/:versionId/activate')
  @RequirePermissions('signatures.activate')
  activateVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @Param('versionId') versionId: string,
  ): Promise<SignatureSummary> {
    return this.signaturesService.activateVersion(
      user.organizationId,
      mailboxId,
      versionId,
      user.id,
    );
  }

  @Post('archive')
  @RequirePermissions('signatures.archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
  ): Promise<SignatureSummary> {
    return this.signaturesService.setStatus(user.organizationId, mailboxId, 'ARCHIVED', user.id);
  }

  @Post('restore')
  @RequirePermissions('signatures.restore')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
  ): Promise<SignatureSummary> {
    return this.signaturesService.setStatus(user.organizationId, mailboxId, 'ACTIVE', user.id);
  }

  @Get('preview')
  @RequirePermissions('signatures.preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
  ): Promise<SignaturePreview> {
    return this.signaturesService.preview(user.organizationId, mailboxId);
  }

  @Post('send-test')
  @RequirePermissions('signatures.test')
  sendTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: SendTestSignatureDto,
  ): Promise<SendTestSignatureResult> {
    return this.signaturesService.sendTest(user.organizationId, mailboxId, dto.to, user.id);
  }
}
