import { runScheduledEmailRepositoryContractTests } from '../contracts/scheduled-email-repository.contract';
import { InMemoryScheduledEmailRepository } from './in-memory-scheduled-email.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryScheduledEmailRepository (contract)', () => {
  let repo: InMemoryScheduledEmailRepository;

  runScheduledEmailRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryScheduledEmailRepository(new MemoryStore());
    },
  );
});
