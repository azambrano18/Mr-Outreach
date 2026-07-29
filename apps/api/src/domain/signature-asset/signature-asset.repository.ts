import { CreateSignatureAssetInput, SignatureAsset, UpdateSignatureAssetInput } from './signature-asset.entity';

export interface SignatureAssetRepository {
  create(input: CreateSignatureAssetInput): Promise<SignatureAsset>;
  findById(id: string): Promise<SignatureAsset | null>;
  findByObjectKey(objectKey: string): Promise<SignatureAsset | null>;
  findByOrganization(organizationId: string): Promise<SignatureAsset[]>;
  update(id: string, input: UpdateSignatureAssetInput): Promise<SignatureAsset>;
}
