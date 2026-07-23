import { runTemplateRepositoryContractTests } from '../contracts/template-repository.contract';
import { InMemoryTemplateRepository } from './in-memory-template.repository';
import { MemoryStore } from './memory-store';

describe('InMemoryTemplateRepository (contract)', () => {
  let repo: InMemoryTemplateRepository;

  runTemplateRepositoryContractTests(
    () => repo,
    () => {
      repo = new InMemoryTemplateRepository(new MemoryStore());
    },
  );
});
