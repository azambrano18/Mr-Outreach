import { runUserRepositoryContractTests } from '../contracts/user-repository.contract';
import { InMemoryUserRepository } from './in-memory-user.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryUserRepository (contract)', () => {
  let store: MemoryStore;
  let repo: InMemoryUserRepository;

  runUserRepositoryContractTests(
    () => repo,
    () => {
      store = new MemoryStore();
      repo = new InMemoryUserRepository(store);
    },
  );
});
