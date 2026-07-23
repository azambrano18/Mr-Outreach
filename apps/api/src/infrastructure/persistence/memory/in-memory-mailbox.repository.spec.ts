import { runMailboxRepositoryContractTests } from '../contracts/mailbox-repository.contract';
import { InMemoryMailboxRepository } from './in-memory-mailbox.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryMailboxRepository (contract)', () => {
  let repo: InMemoryMailboxRepository;

  runMailboxRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryMailboxRepository(new MemoryStore());
    },
  );
});
