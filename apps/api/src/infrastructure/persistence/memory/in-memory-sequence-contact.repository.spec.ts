import { runSequenceContactRepositoryContractTests } from '../contracts/sequence-contact-repository.contract';
import { InMemorySequenceContactRepository } from './in-memory-sequence-contact.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceContactRepository (contract)', () => {
  let repo: InMemorySequenceContactRepository;

  runSequenceContactRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemorySequenceContactRepository(new MemoryStore());
    },
  );
});
