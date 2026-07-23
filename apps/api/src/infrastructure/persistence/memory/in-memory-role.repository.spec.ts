import { runRoleRepositoryContractTests } from '../contracts/role-repository.contract';
import { InMemoryRoleRepository } from './in-memory-role.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryRoleRepository (contract)', () => {
  let repo: InMemoryRoleRepository;

  runRoleRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryRoleRepository(new MemoryStore());
    },
  );
});
