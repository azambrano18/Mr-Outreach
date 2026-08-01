import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { SignatureAssetsService } from '../../application/signature-assets/signature-assets.service';
import { SignatureAssetSummary } from '../../application/signature-assets/signature-assets.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;

/**
 * Fase 2 (R2), §9/§25 — signature images belong to the mailbox now, so the
 * upload route is nested under it (never a bare `/signature-assets`
 * without a mailbox). Admin path only — no assignment check beyond the
 * permission key, mirroring SignaturesController vs MeSignatureController.
 */
@ApiTags('signature-assets')
@ApiBearerAuth()
@Controller('mailboxes/:mailboxId/signature-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SignatureAssetsController {
  constructor(private readonly signatureAssets: SignatureAssetsService) {}

  @Post()
  @RequirePermissions('signatures.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SignatureAssetSummary> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    return this.signatureAssets.upload(user.organizationId, user.id, mailboxId, {
      buffer: file.buffer,
      originalFileName: file.originalname,
    });
  }

  @Delete(':assetId')
  @HttpCode(204)
  @RequirePermissions('signatures.update')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('assetId') assetId: string): Promise<void> {
    await this.signatureAssets.deleteUnreferencedImage(user.organizationId, user.id, assetId);
  }
}

/**
 * Self-service mirror — an executive can only upload to a mailbox actually
 * assigned to them (`SignatureAssetsService.uploadForExecutive` enforces
 * that, 404-not-403, same convention as MeSignatureController).
 */
@ApiTags('me-signature-assets')
@ApiBearerAuth()
@Controller('me/mailboxes/:mailboxId/signature-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeSignatureAssetsController {
  constructor(private readonly signatureAssets: SignatureAssetsService) {}

  @Post()
  @RequirePermissions('signatures.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('mailboxId') mailboxId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SignatureAssetSummary> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    return this.signatureAssets.uploadForExecutive(user.organizationId, user.id, mailboxId, {
      buffer: file.buffer,
      originalFileName: file.originalname,
    });
  }
}
