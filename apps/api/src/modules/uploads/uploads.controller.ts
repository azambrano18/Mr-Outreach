import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ImageStoragePort } from '../../domain/storage/image-storage.port';
import { IMAGE_STORAGE } from '../../infrastructure/storage/tokens';
import { sniffImageType } from '../../infrastructure/storage/image-mime-sniffer';
import { AuthenticatedUser } from '../../application/auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadImageResponse {
  url: string;
}

/**
 * Gated by signatures.update since the only current consumer is the
 * signature rich-text editor (image insertion). Not tied to any specific
 * mailbox/signature id — the resulting URL is embedded into HTML content
 * by the caller afterwards, same as any other CDN-hosted asset.
 */
@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UploadsController {
  constructor(@Inject(IMAGE_STORAGE) private readonly imageStorage: ImageStoragePort) {}

  @Post('images')
  @RequirePermissions('signatures.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  async uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadImageResponse> {
    if (!file) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('La imagen supera el tamaño máximo permitido (5 MB).');
    }

    const sniffed = sniffImageType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException('Formato de imagen no soportado. Usa PNG, JPG, GIF o WebP.');
    }

    const stored = await this.imageStorage.store({
      organizationId: user.organizationId,
      buffer: file.buffer,
      mimeType: sniffed.mimeType,
      extension: sniffed.extension,
    });

    return { url: stored.url };
  }
}
