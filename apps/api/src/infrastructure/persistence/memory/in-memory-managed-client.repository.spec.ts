import { runManagedClientRepositoryContractTests } from '../contracts/managed-client-repository.contract';
import { InMemoryManagedClientRepository } from './in-memory-managed-client.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryManagedClientRepository (contract)', () => {
  let repo: InMemoryManagedClientRepository;

  runManagedClientRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryManagedClientRepository(new MemoryStore());
    },
  );
});
