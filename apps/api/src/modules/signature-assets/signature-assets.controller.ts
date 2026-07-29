import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SignatureAssetsService } from '../../application/signature-assets/signature-assets.service';
import { SignatureAssetSummary } from '../../application/signature-assets/signature-assets.types';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/** §4 — the same door for both an executive and an admin authoring their own Plantilla's signature; gated by the same operational permission the template editor itself requires. */
const MAX_UPLOAD_BYTES = 1 * 1024 * 1024;

@ApiTags('signature-assets')
@ApiBearerAuth()
@Controller('signature-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SignatureAssetsController {
  constructor(private readonly signatureAssets: SignatureAssetsService) {}

  @Post()
  @RequirePermissions('sequence_templates.update_own')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SignatureAssetSummary> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    return this.signatureAssets.upload(user.organizationId, user.id, {
      buffer: file.buffer,
      originalFileName: file.originalname,
    });
  }
}
