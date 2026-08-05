import { runSequenceRepositoryContractTests } from '../contracts/sequence-repository.contract';
import { InMemorySequenceRepository } from './in-memory-sequence.repository';
import { MemoryStore } from './memory-store';

describe('InMemorySequenceRepository (contract) — Sequence.clientId persistence', () => {
  let repo: InMemorySequenceRepository;

  runSequenceRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemorySequenceRepository(new MemoryStore());
    },
    {
      orgId: 'org_1',
      otherOrgId: 'org_2',
      executiveId: 'exec_1',
      clientId: 'client_1',
      otherClientId: 'client_2',
    },
  );
});
