import { TransactionContext } from '../persistence/transaction';
import { CreateSignatureInput, Signature, UpdateSignatureInput } from './signature.entity';

export interface SignatureRepository {
  findById(id: string): Promise<Signature | null>;
  findByMailbox(mailboxId: string, ctx?: TransactionContext): Promise<Signature | null>;
  /** Every signature in the org — used to check whether a variable key is still referenced in any active signature before allowing its catalog entry to be deleted. */
  findAllByOrganization(organizationId: string): Promise<Signature[]>;
  create(input: CreateSignatureInput, ctx?: TransactionContext): Promise<Signature>;
  update(id: string, input: UpdateSignatureInput, ctx?: TransactionContext): Promise<Signature>;
}
