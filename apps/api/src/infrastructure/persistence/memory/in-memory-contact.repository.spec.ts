import { runContactRepositoryContractTests } from '../contracts/contact-repository.contract';
import { InMemoryContactRepository } from './in-memory-contact.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryContactRepository (contract)', () => {
  let repo: InMemoryContactRepository;

  runContactRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryContactRepository(new MemoryStore());
    },
  );
});
