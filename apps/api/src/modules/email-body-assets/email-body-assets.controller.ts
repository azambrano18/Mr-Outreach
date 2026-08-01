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
import { EmailBodyAssetsService } from '../../application/email-body-assets/email-body-assets.service';
import { EmailBodyAssetSummary } from '../../application/email-body-assets/email-body-assets.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/**
 * Fase 2 (R2), §7/§10/§25 — not nested under a specific template/step: a
 * body image is uploaded, then inserted at the editor's cursor position
 * (same pattern the signature editor already used before Fase 2). Gated by
 * the same permission that lets an executive edit their own Plantilla.
 */
@ApiTags('email-body-assets')
@ApiBearerAuth()
@Controller('email-body-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmailBodyAssetsController {
  constructor(private readonly emailBodyAssets: EmailBodyAssetsService) {}

  @Post()
  @RequirePermissions('sequence_templates.update_own')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<EmailBodyAssetSummary> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    return this.emailBodyAssets.upload(user.organizationId, user.id, {
      buffer: file.buffer,
      originalFileName: file.originalname,
    });
  }

  @Delete(':assetId')
  @HttpCode(204)
  @RequirePermissions('sequence_templates.update_own')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('assetId') assetId: string): Promise<void> {
    await this.emailBodyAssets.deleteUnreferencedImage(user.organizationId, user.id, assetId);
  }
}
