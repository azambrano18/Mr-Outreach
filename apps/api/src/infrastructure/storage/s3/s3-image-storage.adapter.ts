import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  ImageStoragePort,
  StoreImageInput,
  StoredImage,
} from '../../../domain/storage/image-storage.port';

/**
 * Stub. There is no S3 (or S3-compatible) bucket provisioned for this
 * project yet — mirrors HttpEngineClient's stance on the real execution
 * engine: the driver exists and is selectable via STORAGE_DRIVER=s3, but
 * actually using it requires credentials this environment doesn't have.
 * Swap this method body for a real `@aws-sdk/client-s3` PutObject call
 * once a bucket exists; nothing else in the app needs to change.
 */
@Injectable()
export class S3ImageStorageAdapter implements ImageStoragePort {
  async store(_input: StoreImageInput): Promise<StoredImage> {
    throw new ServiceUnavailableException(
      'STORAGE_DRIVER=s3 is selected but no S3-compatible bucket is configured yet.',
    );
  }
}
