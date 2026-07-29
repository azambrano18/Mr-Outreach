import { TransactionContext } from '../persistence/transaction';
import { CreateSignatureVersionInput, SignatureVersion } from './signature-version.entity';

export interface SignatureVersionRepository {
  create(input: CreateSignatureVersionInput, ctx?: TransactionContext): Promise<SignatureVersion>;
  findById(id: string): Promise<SignatureVersion | null>;
  /** Most recent (highest versionNumber) first. */
  findBySignature(signatureId: string): Promise<SignatureVersion[]>;
}
