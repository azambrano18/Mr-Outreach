import { runCompanyRepositoryContractTests } from '../contracts/company-repository.contract';
import { InMemoryCompanyRepository } from './in-memory-company.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryCompanyRepository (contract)', () => {
  let repo: InMemoryCompanyRepository;

  runCompanyRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryCompanyRepository(new MemoryStore());
    },
  );
});
