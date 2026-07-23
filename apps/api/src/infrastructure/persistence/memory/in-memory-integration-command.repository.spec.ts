import { runIntegrationCommandRepositoryContractTests } from '../contracts/integration-command-repository.contract';
import { InMemoryIntegrationCommandRepository } from './in-memory-integration-command.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryIntegrationCommandRepository (contract)', () => {
  let repo: InMemoryIntegrationCommandRepository;

  runIntegrationCommandRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryIntegrationCommandRepository(new MemoryStore());
    },
  );
});
