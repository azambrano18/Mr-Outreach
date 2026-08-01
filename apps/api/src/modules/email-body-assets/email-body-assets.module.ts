import { Module } from '@nestjs/common';
import { EmailBodyAssetsService } from '../../application/email-body-assets/email-body-assets.service';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { SignatureAssetStorageModule } from '../../infrastructure/signature-asset-storage/signature-asset-storage.module';
import { AuthModule } from '../auth/auth.module';
import { EmailBodyAssetsController } from './email-body-assets.controller';

@Module({
  imports: [PersistenceModule, SignatureAssetStorageModule, AuthModule],
  controllers: [EmailBodyAssetsController],
  providers: [EmailBodyAssetsService],
  exports: [EmailBodyAssetsService],
})
export class EmailBodyAssetsModule {}
