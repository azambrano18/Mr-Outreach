import { runVariableRepositoryContractTests } from '../contracts/variable-repository.contract';
import { InMemoryVariableRepository } from './in-memory-variable.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryVariableRepository (contract)', () => {
  let repo: InMemoryVariableRepository;

  runVariableRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryVariableRepository(new MemoryStore());
    },
  );
});
