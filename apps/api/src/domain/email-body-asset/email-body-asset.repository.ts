import { CreateEmailBodyAssetInput, EmailBodyAsset, UpdateEmailBodyAssetInput } from './email-body-asset.entity';

export interface EmailBodyAssetRepository {
  create(input: CreateEmailBodyAssetInput): Promise<EmailBodyAsset>;
  findById(id: string): Promise<EmailBodyAsset | null>;
  findByObjectKey(objectKey: string): Promise<EmailBodyAsset | null>;
  findByOrganization(organizationId: string): Promise<EmailBodyAsset[]>;
  update(id: string, input: UpdateEmailBodyAssetInput): Promise<EmailBodyAsset>;
}
