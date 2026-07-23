import { runSignatureRepositoryContractTests } from '../contracts/signature-repository.contract';
import { InMemorySignatureRepository } from './in-memory-signature.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySignatureRepository (contract)', () => {
  let repo: InMemorySignatureRepository;

  runSignatureRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemorySignatureRepository(new MemoryStore());
    },
  );
});
