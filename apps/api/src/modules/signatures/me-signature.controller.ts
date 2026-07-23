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
import { SendTestSignatureDto } from './dto/send-test-signature.dto';
import { UpdateSignatureDto } from './dto/update-signature.dto';

/**
 * Self-service mirror of SignaturesController — the firma still belongs
 * to the mailbox (never the executive), this only lets an executive
 * manage the signature of a mailbox actually assigned to them.
 * `SignaturesService` enforces that via `requireAssignedMailbox` (an
 * assignment check, not just organizationId) before touching anything —
 * unlike the admin controller, which trusts the permission key alone.
 */
@ApiTags('me-signature')
@ApiBearerAuth()
@Controller('me/mailboxes/:mailboxId/signature')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSignatureController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Get()
  @RequirePermissions('signatures.read')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
  ): Promise<SignatureSummary> {
    return this.signaturesService.getByMailboxForExecutive(user.organizationId, user.id, mailboxId);
  }

  /** Decides create-vs-update itself — see SignaturesService.saveForExecutive. */
  @Patch()
  @RequirePermissions('signatures.update')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: UpdateSignatureDto,
  ): Promise<SignatureSummary> {
    return this.signaturesService.saveForExecutive(
      user.organizationId,
      user.id,
      mailboxId,
      dto.htmlContent,
      dto.plainTextContent,
      user.id,
    );
  }

  @Get('preview')
  @RequirePermissions('signatures.preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
  ): Promise<SignaturePreview> {
    return this.signaturesService.previewForExecutive(user.organizationId, user.id, mailboxId);
  }

  @Post('send-test')
  @RequirePermissions('signatures.test')
  sendTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @Body() dto: SendTestSignatureDto,
  ): Promise<SendTestSignatureResult> {
    return this.signaturesService.sendTestForExecutive(
      user.organizationId,
      user.id,
      mailboxId,
      dto.to,
      user.id,
    );
  }
}
