import { runIntegrationEventRepositoryContractTests } from '../contracts/integration-event-repository.contract';
import { InMemoryIntegrationEventRepository } from './in-memory-integration-event.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryIntegrationEventRepository (contract)', () => {
  let repo: InMemoryIntegrationEventRepository;

  runIntegrationEventRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryIntegrationEventRepository(new MemoryStore());
    },
  );
});
