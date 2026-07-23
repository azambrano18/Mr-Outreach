import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { LocalImageStorageAdapter } from './local/local-image-storage.adapter';
import { S3ImageStorageAdapter } from './s3/s3-image-storage.adapter';
import { IMAGE_STORAGE } from './tokens';

@Module({
  imports: [AppConfigModule],
  providers: [
    LocalImageStorageAdapter,
    S3ImageStorageAdapter,
    {
      provide: IMAGE_STORAGE,
      useFactory: (
        config: AppConfigService,
        local: LocalImageStorageAdapter,
        s3: S3ImageStorageAdapter,
      ) => (config.storageDriver === 's3' ? s3 : local),
      inject: [AppConfigService, LocalImageStorageAdapter, S3ImageStorageAdapter],
    },
  ],
  exports: [IMAGE_STORAGE],
})
export class StorageModule {}
