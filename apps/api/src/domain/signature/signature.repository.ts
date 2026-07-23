import { CreateSignatureInput, Signature, UpdateSignatureInput } from './signature.entity';

export interface SignatureRepository {
  findById(id: string): Promise<Signature | null>;
  findByMailbox(mailboxId: string): Promise<Signature | null>;
  /** Every signature in the org — used to check whether a variable key is still referenced in any active signature before allowing its catalog entry to be deleted. */
  findAllByOrganization(organizationId: string): Promise<Signature[]>;
  create(input: CreateSignatureInput): Promise<Signature>;
  update(id: string, input: UpdateSignatureInput): Promise<Signature>;
}
